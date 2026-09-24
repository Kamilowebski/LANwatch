import concurrent.futures
import getpass
import hashlib
import hmac
import json
import os
import platform
import re
import secrets
import shutil
import socket
import subprocess
import sys
import threading
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from datetime import datetime, timedelta
from pathlib import Path
from urllib.parse import parse_qs, urlparse


ROOT = Path(__file__).resolve().parent
DATA_DIR = Path(os.environ.get("DEVICE_PANEL_DATA_DIR", str(ROOT))).resolve()
DATA_FILE = DATA_DIR / "devices.json"
CONFIG_FILE = DATA_DIR / "config.json"
PASSWORD_FILE = DATA_DIR / "admin_password.json"
LOG_FILE = DATA_DIR / "changes.log"
BACKUPS_DIR = DATA_DIR / "backups"
STATS_DIR = DATA_DIR / "stats"
MAX_BACKUPS = 30
PORT = 5000

ADMIN_SALT = None
ADMIN_HASH = None


def hash_password(password, salt=None):
    if salt is None:
        salt = secrets.token_hex(16)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), bytes.fromhex(salt), 200_000)
    return salt, digest.hex()


def verify_password(password, salt, expected_hash):
    if not salt or not expected_hash or not password:
        return False
    _, digest = hash_password(password, salt)
    return hmac.compare_digest(digest, expected_hash)


def prompt_new_password():
    password = getpass.getpass("Ustaw haslo administratora (do zapisu zmian): ")
    confirm = getpass.getpass("Powtorz haslo: ")
    while not password or password != confirm:
        print("Hasla nie byly takie same albo byly puste - sprobuj ponownie.")
        password = getpass.getpass("Ustaw haslo administratora: ")
        confirm = getpass.getpass("Powtorz haslo: ")
    return password


def load_or_create_password_file():
    if PASSWORD_FILE.exists():
        with PASSWORD_FILE.open("r", encoding="utf-8") as file:
            data = json.load(file)
        return data["salt"], data["hash"]

    print("=" * 70)
    print("Pierwsze uruchomienie: nie znaleziono zapisanego hasla administratora.")
    env_password = os.environ.get("DEVICE_PANEL_PASSWORD")
    if env_password:
        print("Znaleziono haslo w zmiennej DEVICE_PANEL_PASSWORD - zapisuje je (zahashowane) do pliku,")
        print("od teraz zmienna nie bedzie juz potrzebna.")
        password = env_password
    else:
        password = prompt_new_password()

    salt, digest = hash_password(password)
    atomic_write_json(PASSWORD_FILE, {"salt": salt, "hash": digest})
    print(f"Haslo zapisane w zahashowanej postaci w: {PASSWORD_FILE}")
    print("Aby zmienic haslo pozniej, uruchom: python app.py --set-password")
    print("=" * 70)
    return salt, digest


DEFAULT_CONFIG = {
    "areas": ["EXPORT", "MALA PACZKA", "ROZBIOR"],
    "types": ["terminal", "drukarka", "komputer", "bizerba", "maszyna", "inne"],
    "groups": [],
    "sshUser": "",
    "vncLocalPort": 5900,
    "vncRemotePort": 5900,
    "vncViewerPath": "",
    "statsEnabled": False,
    "statsIntervalMinutes": 15,
    "statsRetentionDays": 90,
    "statsPingConcurrency": 24,
    "backupEnabled": True,
    "backupHour": 13,
    "backupMinute": 30,
    "backupRetentionDays": 30,
}

AREAS = {
    "104": "Starachowice",
}

TYPE_PREFIXES = {
    "T": "terminal",
    "P": "drukarka",
    "K": "komputer",
    "B": "bizerba",
}


WRITE_LOCK = threading.Lock()


def read_devices():
    if not DATA_FILE.exists():
        return []
    with DATA_FILE.open("r", encoding="utf-8") as file:
        return json.load(file)


def compute_file_version(path):
    if not path.exists():
        return None
    return hashlib.sha256(path.read_bytes()).hexdigest()


def atomic_write_json(path, payload):
    tmp_path = path.with_suffix(path.suffix + ".tmp")
    with tmp_path.open("w", encoding="utf-8") as file:
        json.dump(payload, file, ensure_ascii=False, indent=2)
    os.replace(tmp_path, path)


def log_change(client_ip, action, details=""):
    timestamp = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    line = f"{timestamp} | {client_ip or 'nieznane IP'} | {action} | {details}\n"
    try:
        with LOG_FILE.open("a", encoding="utf-8") as file:
            file.write(line)
    except OSError:
        pass


def backup_file_on_startup(path):
    if not path.exists():
        return None
    try:
        BACKUPS_DIR.mkdir(exist_ok=True)
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        backup_path = BACKUPS_DIR / f"{path.stem}_{timestamp}{path.suffix}"
        shutil.copy2(path, backup_path)

        existing = sorted(
            BACKUPS_DIR.glob(f"{path.stem}_*{path.suffix}"),
            key=lambda item: item.stat().st_mtime,
            reverse=True,
        )
        for old_backup in existing[MAX_BACKUPS:]:
            old_backup.unlink(missing_ok=True)

        return backup_path
    except OSError as error:
        print(f"UWAGA: nie udalo sie zrobic kopii zapasowej {path.name}: {error}")
        return None


def write_devices(devices):
    atomic_write_json(DATA_FILE, devices)


def normalize_words(values):
    if isinstance(values, str):
        values = values.replace(";", ",").split(",")
    if not isinstance(values, list):
        values = []
    cleaned = []
    seen = set()
    for value in values:
        word = str(value).strip()
        key = word.lower()
        if word and key not in seen:
            cleaned.append(word)
            seen.add(key)
    return cleaned


def read_config():
    config = dict(DEFAULT_CONFIG)
    if CONFIG_FILE.exists():
        with CONFIG_FILE.open("r", encoding="utf-8") as file:
            loaded = json.load(file)
        config.update({key: loaded.get(key, value) for key, value in DEFAULT_CONFIG.items()})

    devices = read_devices()
    config["areas"] = sorted(set(normalize_words(config["areas"]) + normalize_words([device.get("area", "") for device in devices])))
    config["types"] = sorted(set(normalize_words(config["types"]) + normalize_words([device.get("type", "") for device in devices])))
    config["groups"] = sorted(set(normalize_words(config["groups"]) + normalize_words([device.get("group", "") for device in devices])))
    return config


def parse_port(value, fallback):
    try:
        port = int(value)
        if 1 <= port <= 65535:
            return port
    except (TypeError, ValueError):
        pass
    return fallback


def parse_bounded_int(value, fallback, minimum, maximum):
    try:
        num = int(value)
        if num < minimum:
            return minimum
        if num > maximum:
            return maximum
        return num
    except (TypeError, ValueError):
        return fallback


def write_config(config):
    payload = {
        "areas": normalize_words(config.get("areas", [])),
        "types": normalize_words(config.get("types", [])),
        "groups": normalize_words(config.get("groups", [])),
        "sshUser": str(config.get("sshUser", "") or "").strip(),
        "vncLocalPort": parse_port(config.get("vncLocalPort"), DEFAULT_CONFIG["vncLocalPort"]),
        "vncRemotePort": parse_port(config.get("vncRemotePort"), DEFAULT_CONFIG["vncRemotePort"]),
        "vncViewerPath": str(config.get("vncViewerPath", "") or "").strip(),
        "statsEnabled": bool(config.get("statsEnabled", DEFAULT_CONFIG["statsEnabled"])),
        "statsIntervalMinutes": parse_bounded_int(config.get("statsIntervalMinutes"), DEFAULT_CONFIG["statsIntervalMinutes"], 1, 1440),
        "statsRetentionDays": parse_bounded_int(config.get("statsRetentionDays"), DEFAULT_CONFIG["statsRetentionDays"], 1, 3650),
        "statsPingConcurrency": parse_bounded_int(config.get("statsPingConcurrency"), DEFAULT_CONFIG["statsPingConcurrency"], 4, 64),
        "backupEnabled": bool(config.get("backupEnabled", DEFAULT_CONFIG["backupEnabled"])),
        "backupHour": parse_bounded_int(config.get("backupHour"), DEFAULT_CONFIG["backupHour"], 0, 23),
        "backupMinute": parse_bounded_int(config.get("backupMinute"), DEFAULT_CONFIG["backupMinute"], 0, 59),
        "backupRetentionDays": parse_bounded_int(config.get("backupRetentionDays"), DEFAULT_CONFIG["backupRetentionDays"], 1, 3650),
    }
    atomic_write_json(CONFIG_FILE, payload)
    return payload


def enrich_device(device):
    device = dict(device)
    name = device.get("name", "").strip().upper()
    device["name"] = name
    match = re.match(r"^([A-Z])(\d{3})-(\d{4})$", name)
    if match:
        prefix, area_code, number = match.groups()
        device.setdefault("type", TYPE_PREFIXES.get(prefix, "inne"))
        device["areaCode"] = area_code
        device.setdefault("site", AREAS.get(area_code, f"Zaklad {area_code}"))
        device["number"] = number

    if "keywords" not in device or not isinstance(device["keywords"], list):
        device["keywords"] = normalize_words(device.get("keywords", ""))

    device.setdefault("type", "inne")
    device["ip"] = device.get("ip", "").strip()
    if not device.get("addressMode"):
        device["addressMode"] = "static" if device["type"] == "bizerba" else "dhcp"
    device.setdefault("area", "")
    device.setdefault("site", "")
    device.setdefault("note", "")
    device["systemId"] = str(device.get("systemId", "") or "").strip()
    device["group"] = str(device.get("group", "") or "").strip()
    device["vncUsername"] = str(device.get("vncUsername", "") or "").strip()

    if "dependencies" not in device or not isinstance(device["dependencies"], list):
        device["dependencies"] = []
    device["dependencies"] = [str(d).strip().upper() for d in device["dependencies"] if str(d).strip()]

    device["mac"] = str(device.get("mac", "") or "").strip()
    device["netmask"] = str(device.get("netmask", "") or "").strip()
    device["gateway"] = str(device.get("gateway", "") or "").strip()
    device["dns"] = str(device.get("dns", "") or "").strip()

    if device["type"] == "bizerba":
        device["numerator"] = str(device.get("numerator", "") or "").strip()
    else:
        device.pop("numerator", None)

    device.pop("remoteAccess", None)

    return device


def require_password(handler, payload=None):
    password = handler.headers.get("X-Admin-Password", "")
    if payload and not password:
        password = payload.get("password", "")
    if not verify_password(password, ADMIN_SALT, ADMIN_HASH):
        handler.send_json({"error": "Niepoprawne haslo administratora"}, status=403)
        return False
    return True


def find_device_by_name(name):
    wanted = name.strip().upper()
    for device in [enrich_device(item) for item in read_devices()]:
        if device.get("name") == wanted:
            return device
    return None


def ping_host(target, count=3):
    system = platform.system().lower()
    if system == "windows":
        command = ["ping", "-n", str(count), "-w", "500", target]
    else:
        command = ["ping", "-c", str(count), "-W", "1", target]

    try:
        result = subprocess.run(
            command,
            capture_output=True,
            text=True,
            timeout=max(3, count * 2),
            encoding="utf-8",
            errors="replace",
        )
    except Exception as error:
        return {"online": False, "latencyMs": None, "error": str(error)}

    output = result.stdout + result.stderr
    latency = None
    latency_match = re.search(r"(?:time|czas)[=<]\s*(\d+)\s*ms", output, re.IGNORECASE)
    if latency_match:
        latency = int(latency_match.group(1))

    resolved_ip = None
    resolved_match = re.search(r"\[(\d{1,3}(?:\.\d{1,3}){3})\]", output)
    if not resolved_match:
        resolved_match = re.search(r"(?:Reply from|Odpowiedź z)\s+(\d{1,3}(?:\.\d{1,3}){3})", output, re.IGNORECASE)
    if resolved_match:
        resolved_ip = resolved_match.group(1)

    return {
        "online": result.returncode == 0,
        "latencyMs": latency,
        "target": target,
        "resolvedIp": resolved_ip,
        "raw": output[-800:],
    }


def device_ping_target(device):
    if device.get("addressMode") == "dhcp":
        return device.get("name")
    return device.get("ip") or device.get("name")


MAX_SCAN_ADDRESSES = 256


def parse_ip_range(range_str):
    range_str = (range_str or "").strip()
    if "-" not in range_str:
        raise ValueError("Nieprawidlowy zakres - uzyj formatu 192.168.1.1-192.168.1.254 albo 192.168.1.1-254")

    start_str, end_str = range_str.split("-", 1)
    start_str = start_str.strip()
    end_str = end_str.strip()

    start_parts = start_str.split(".")
    if len(start_parts) != 4:
        raise ValueError("Nieprawidlowy adres poczatkowy")

    if "." in end_str:
        end_parts = end_str.split(".")
        if len(end_parts) != 4:
            raise ValueError("Nieprawidlowy adres koncowy")
    else:
        end_parts = start_parts[:3] + [end_str]

    try:
        start_octets = tuple(int(p) for p in start_parts)
        end_octets = tuple(int(p) for p in end_parts)
    except ValueError:
        raise ValueError("Adresy IP moga zawierac tylko cyfry i kropki")

    for octet in start_octets + end_octets:
        if not (0 <= octet <= 255):
            raise ValueError("Oktet adresu IP musi byc w zakresie 0-255")

    if start_octets[:3] != end_octets[:3]:
        raise ValueError("Skaner obsluguje tylko zakres w jednej podsieci (te same pierwsze 3 oktety)")

    start_last, end_last = start_octets[3], end_octets[3]
    if start_last > end_last:
        raise ValueError("Adres poczatkowy musi byc mniejszy lub rowny koncowemu")

    if end_last - start_last + 1 > MAX_SCAN_ADDRESSES:
        raise ValueError(f"Zakres zbyt duzy - maksymalnie {MAX_SCAN_ADDRESSES} adresow na raz")

    prefix = ".".join(str(p) for p in start_octets[:3])
    return [f"{prefix}.{i}" for i in range(start_last, end_last + 1)]


_HOSTNAME_EXECUTOR = concurrent.futures.ThreadPoolExecutor(max_workers=32)


def resolve_hostname(ip, timeout=1.5):
    future = _HOSTNAME_EXECUTOR.submit(socket.gethostbyaddr, ip)
    try:
        hostname, _aliases, _addrs = future.result(timeout=timeout)
        return hostname.split(".")[0] if hostname else None
    except Exception:
        return None


def scan_network(ip_list, max_workers=24):
    online = {}

    def scan_one(ip):
        result = ping_host(ip, count=1)
        if result.get("online"):
            result["hostname"] = resolve_hostname(ip)
        return ip, result

    with concurrent.futures.ThreadPoolExecutor(max_workers=max_workers) as executor:
        futures = [executor.submit(scan_one, ip) for ip in ip_list]
        for future in concurrent.futures.as_completed(futures):
            ip, result = future.result()
            if result.get("online"):
                online[ip] = result

    return online


def scan_ports(host, ports, timeout=0.5):
    """Skanuje listę portów TCP na podanym hoście. Zwraca {port: 'open'|'closed'|'filtered'}."""
    results = {}

    def check_one(port):
        try:
            with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
                sock.settimeout(timeout)
                result = sock.connect_ex((host, port))
                if result == 0:
                    return port, "open"
                elif result in (111, 61):
                    return port, "closed"
                else:
                    return port, "filtered"
        except socket.timeout:
            return port, "filtered"
        except socket.gaierror:
            return port, "error"
        except Exception:
            return port, "error"

    with concurrent.futures.ThreadPoolExecutor(max_workers=15) as executor:
        futures = {executor.submit(check_one, port): port for port in ports}
        for future in concurrent.futures.as_completed(futures):
            port, status = future.result()
            results[port] = status

    return results


def send_wol(mac_address, broadcast="255.255.255.255", port=9):
    """Wysyła magic packet Wake-on-LAN na podany adres MAC."""
    mac_clean = mac_address.replace(":", "").replace("-", "").replace(".", "").strip()
    if len(mac_clean) != 12:
        return {"ok": False, "error": "Nieprawidlowy adres MAC (oczekiwano 12 znakow hex)"}
    try:
        mac_bytes = bytes.fromhex(mac_clean)
    except ValueError:
        return {"ok": False, "error": "Adres MAC zawiera nieprawidlowe znaki"}

    magic = b"\xff" * 6 + mac_bytes * 16

    try:
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as sock:
            sock.setsockopt(socket.SOL_SOCKET, socket.SO_BROADCAST, 1)
            sock.sendto(magic, (broadcast, port))
            if port == 9:
                sock.sendto(magic, (broadcast, 7))
    except Exception as error:
        return {"ok": False, "error": str(error)}

    return {"ok": True, "mac": mac_address, "broadcast": broadcast, "port": port}


def run_traceroute(host, max_hops=15, timeout=2):
    """Uruchamia traceroute do hosta. Czeka na pełny wynik (max_hops × timeout sekund).
    Zwraca listę hopów: [{hop, host, latencyMs, status}] gdzie status to 'ok'|'timeout'|'error'."""
    system = platform.system().lower()

    if system == "windows":
        command = ["tracert", "-h", str(max_hops), "-w", str(timeout * 1000), "-d", host]
    else:
        command = ["traceroute", "-m", str(max_hops), "-w", str(timeout), "-n", host]

    try:
        result = subprocess.run(
            command,
            capture_output=True,
            text=True,
            timeout=max_hops * timeout + 10,
            encoding="utf-8",
            errors="replace",
        )
    except FileNotFoundError:
        return {"ok": False, "error": "Nie znaleziono polecenia 'tracert'/'traceroute'. Zainstaluj je w systemie."}
    except subprocess.TimeoutExpired:
        return {"ok": False, "error": "Traceroute przekroczył limit czasu."}
    except Exception as error:
        return {"ok": False, "error": str(error)}

    output = result.stdout + result.stderr
    hops = []

    if system == "windows":
        # Wiersze typu: "  1    <1 ms    <1 ms    <1 ms  192.168.1.1"
        # lub: "  2     *        *        *     Request timed out."
        for line in output.splitlines():
            line = line.strip()
            match = re.match(r"^(\d+)\s+(.+)$", line)
            if not match:
                continue
            hop_num = int(match.group(1))
            rest = match.group(2).strip()

            if "timed out" in rest.lower() or "*" * 3 in rest:
                hops.append({"hop": hop_num, "host": None, "latencyMs": None, "status": "timeout"})
                continue

            ip_match = re.search(r"(\d{1,3}(?:\.\d{1,3}){3})", rest)
            latency_match = re.search(r"(?:<\s*)?(\d+)\s*ms", rest)
            hops.append({
                "hop": hop_num,
                "host": ip_match.group(1) if ip_match else None,
                "latencyMs": int(latency_match.group(1)) if latency_match else None,
                "status": "ok" if ip_match else "timeout",
            })
    else:
        # Wiersze typu: " 1  192.168.1.1  1.234 ms  1.100 ms  1.050 ms"
        # lub: " 2  * * *"
        for line in output.splitlines():
            line = line.strip()
            match = re.match(r"^(\d+)\s+(.+)$", line)
            if not match:
                continue
            hop_num = int(match.group(1))
            rest = match.group(2).strip()

            if rest.startswith("*"):
                hops.append({"hop": hop_num, "host": None, "latencyMs": None, "status": "timeout"})
                continue

            ip_match = re.search(r"(\d{1,3}(?:\.\d{1,3}){3})", rest)
            latency_match = re.search(r"(\d+(?:\.\d+)?)\s*ms", rest)
            hops.append({
                "hop": hop_num,
                "host": ip_match.group(1) if ip_match else None,
                "latencyMs": int(float(latency_match.group(1))) if latency_match else None,
                "status": "ok" if ip_match else "timeout",
            })

    if not hops:
        return {"ok": False, "error": "Nie udało się sparsować wyniku traceroute.", "raw": output[-1500:]}

    return {"ok": True, "target": host, "hops": hops}

def build_ssh_target(device, ssh_user):
    host = device.get("name") if device.get("addressMode") == "dhcp" else (device.get("ip") or device.get("name"))
    ssh_user = (ssh_user or "").strip()
    return f"{ssh_user}@{host}" if ssh_user else host


def launch_ssh_tunnel(device, ssh_user, local_port, remote_port):
    ssh_path = shutil.which("ssh")
    if not ssh_path:
        return {
            "ok": False,
            "error": "Nie znaleziono polecenia 'ssh'. Zainstaluj klienta OpenSSH "
                     "(Windows: Ustawienia > Aplikacje > Opcjonalne funkcje > Dodaj funkcję > OpenSSH Client).",
        }

    target = build_ssh_target(device, ssh_user)
    forward = f"{local_port}:127.0.0.1:{remote_port}"
    command = [ssh_path, "-o", "StrictHostKeyChecking=accept-new", "-L", forward, target]
    system = platform.system().lower()

    try:
        if system == "windows":
            creationflags = getattr(subprocess, "CREATE_NEW_CONSOLE", 0)
            subprocess.Popen(command, creationflags=creationflags)
        elif system == "darwin":
            script = f'tell application "Terminal" to do script "{" ".join(command)}"'
            subprocess.Popen(["osascript", "-e", script])
        else:
            terminal = None
            for candidate in ("x-terminal-emulator", "gnome-terminal", "konsole", "xfce4-terminal", "xterm"):
                if shutil.which(candidate):
                    terminal = candidate
                    break
            if not terminal:
                return {"ok": False, "error": "Nie znaleziono terminala graficznego do uruchomienia SSH."}
            if terminal == "gnome-terminal":
                subprocess.Popen([terminal, "--", *command])
            else:
                subprocess.Popen([terminal, "-e", " ".join(command)])
    except Exception as error:
        return {"ok": False, "error": str(error)}

    return {"ok": True, "target": target, "localPort": local_port, "remotePort": remote_port}


def launch_ssh_raw(host, local_port, remote_port, ssh_user=""):
    """SSH do hosta spoza bazy. Jeśli ssh_user podany — user@host, inaczej raw."""
    ssh_path = shutil.which("ssh")
    if not ssh_path:
        return {
            "ok": False,
            "error": "Nie znaleziono polecenia 'ssh'. Zainstaluj klienta OpenSSH "
                     "(Windows: Ustawienia > Aplikacje > Opcjonalne funkcje > Dodaj funkcję > OpenSSH Client).",
        }

    host = (host or "").strip()
    if not host:
        return {"ok": False, "error": "Brak hosta."}

    ssh_user = (ssh_user or "").strip()
    target = f"{ssh_user}@{host}" if ssh_user else host

    forward = f"{local_port}:127.0.0.1:{remote_port}"
    command = [ssh_path, "-o", "StrictHostKeyChecking=accept-new", "-L", forward, target]
    system = platform.system().lower()

    try:
        if system == "windows":
            creationflags = getattr(subprocess, "CREATE_NEW_CONSOLE", 0)
            subprocess.Popen(command, creationflags=creationflags)
        elif system == "darwin":
            script = f'tell application "Terminal" to do script "{" ".join(command)}"'
            subprocess.Popen(["osascript", "-e", script])
        else:
            terminal = None
            for candidate in ("x-terminal-emulator", "gnome-terminal", "konsole", "xfce4-terminal", "xterm"):
                if shutil.which(candidate):
                    terminal = candidate
                    break
            if not terminal:
                return {"ok": False, "error": "Nie znaleziono terminala graficznego do uruchomienia SSH."}
            if terminal == "gnome-terminal":
                subprocess.Popen([terminal, "--", *command])
            else:
                subprocess.Popen([terminal, "-e", " ".join(command)])
    except Exception as error:
        return {"ok": False, "error": str(error)}

    return {"ok": True, "target": target, "localPort": local_port, "remotePort": remote_port}


def find_vnc_viewer(configured_path=""):
    configured_path = (configured_path or "").strip()
    if configured_path and Path(configured_path).exists():
        return configured_path

    found = shutil.which("vncviewer") or shutil.which("vncviewer.exe") or shutil.which("tigervnc")
    if found:
        return found

    common_paths = [
        r"C:\Program Files\TigerVNC\vncviewer.exe",
        r"C:\Program Files (x86)\TigerVNC\vncviewer.exe",
        "/usr/bin/vncviewer",
        "/usr/local/bin/vncviewer",
        "/Applications/TigerVNC Viewer.app/Contents/MacOS/TigerVNC Viewer",
    ]
    for candidate in common_paths:
        if Path(candidate).exists():
            return candidate
    return None


def launch_vnc(vnc_path, target_host, port, vnc_username=""):
    if not vnc_path:
        return {
            "ok": False,
            "error": "Nie znaleziono programu vncviewer (TigerVNC). Zainstaluj go albo podaj "
                     "pelna sciezke do vncviewer.exe w ustawieniach tunelu.",
        }

    target = f"{target_host}::{port}"

    env = os.environ.copy()
    if vnc_username:
        env["VNC_USERNAME"] = vnc_username

    try:
        subprocess.Popen([vnc_path, target], env=env)
    except Exception as error:
        return {"ok": False, "error": str(error)}

    return {"ok": True, "target": target}


def launch_vnc_raw(vnc_path, host, port):
    """VNC bez użytkownika — do szybkiego połączenia z hostem spoza bazy."""
    if not vnc_path:
        return {
            "ok": False,
            "error": "Nie znaleziono programu vncviewer (TigerVNC). Zainstaluj go albo podaj "
                     "pelna sciezke do vncviewer.exe w ustawieniach tunelu.",
        }

    host = (host or "").strip()
    if not host:
        return {"ok": False, "error": "Brak hosta."}

    target = f"{host}::{port}"

    try:
        subprocess.Popen([vnc_path, target])
    except Exception as error:
        return {"ok": False, "error": str(error)}

    return {"ok": True, "target": target}

# ============================================================
# STATYSTYKI PINGÓW W TLE + AUTO-BACKUP
# ============================================================

STATS_DIR = DATA_DIR / "stats"

stats_thread_stop = threading.Event()
backup_thread_stop = threading.Event()


def ping_host_fast(target):
    """Lżejsza wersja ping_host — 1 pakiet, krótki timeout. Do masowego pingowania."""
    system = platform.system().lower()
    if system == "windows":
        command = ["ping", "-n", "1", "-w", "800", target]
    else:
        command = ["ping", "-c", "1", "-W", "1", target]

    try:
        result = subprocess.run(
            command,
            capture_output=True,
            text=True,
            timeout=3,
            encoding="utf-8",
            errors="replace",
        )
    except Exception:
        return {"online": False, "latencyMs": None}

    output = result.stdout + result.stderr
    latency = None
    latency_match = re.search(r"(?:time|czas)[=<]\s*(\d+)\s*ms", output, re.IGNORECASE)
    if latency_match:
        latency = int(latency_match.group(1))

    return {
        "online": result.returncode == 0,
        "latencyMs": latency,
    }


def stats_ping_cycle():
    """Jeden cykl pingowania wszystkich urządzeń i zapis do pliku dnia."""
    devices = [enrich_device(d) for d in read_devices()]
    if not devices:
        return {"ok": True, "count": 0, "online": 0, "offline": 0, "skipped": True}

    today = datetime.now().strftime("%Y-%m-%d")
    stats_file = STATS_DIR / f"stats_{today}.json"

    if stats_file.exists():
        try:
            with stats_file.open("r", encoding="utf-8") as file:
                data = json.load(file)
        except (OSError, json.JSONDecodeError):
            data = {"date": today, "devices": {}}
    else:
        data = {"date": today, "devices": {}}

    if not isinstance(data.get("devices"), dict):
        data["devices"] = {}

    config = read_config()
    concurrency = config.get("statsPingConcurrency", DEFAULT_CONFIG["statsPingConcurrency"])

    timestamp = int(datetime.now().timestamp())
    online_count = 0
    offline_count = 0

    def ping_one(device):
        name = device.get("name")
        if not name:
            return None
        target = device_ping_target(device)
        result = ping_host_fast(target)
        return name, result

    with concurrent.futures.ThreadPoolExecutor(max_workers=concurrency) as executor:
        futures = [executor.submit(ping_one, d) for d in devices]
        for future in concurrent.futures.as_completed(futures):
            outcome = future.result()
            if outcome is None:
                continue
            name, result = outcome
            entry = {
                "t": timestamp,
                "online": result.get("online", False),
                "ms": result.get("latencyMs"),
            }
            data["devices"].setdefault(name, []).append(entry)
            if entry["online"]:
                online_count += 1
            else:
                offline_count += 1

    data["interval"] = config.get("statsIntervalMinutes", DEFAULT_CONFIG["statsIntervalMinutes"]) * 60
    data["lastUpdate"] = timestamp

    atomic_write_json(stats_file, data)

    # Retencja
    retention = config.get("statsRetentionDays", DEFAULT_CONFIG["statsRetentionDays"])
    cutoff_date = (datetime.now() - timedelta(days=retention)).strftime("%Y-%m-%d")
    for old_file in STATS_DIR.glob("stats_*.json"):
        try:
            file_date = old_file.stem.replace("stats_", "")
            if file_date < cutoff_date:
                old_file.unlink(missing_ok=True)
        except Exception:
            pass

    return {"ok": True, "count": len(devices), "online": online_count, "offline": offline_count, "date": today}


def stats_worker():
    """Wątek pingujący w tle co X minut."""
    # Odczekaj chwilę na start serwera
    if stats_thread_stop.wait(10):
        return

    while not stats_thread_stop.is_set():
        try:
            config = read_config()
            if config.get("statsEnabled"):
                stats_ping_cycle()
        except Exception as error:
            print(f"[stats] Błąd cyklu: {error}")

        try:
            config = read_config()
            interval_min = int(config.get("statsIntervalMinutes", DEFAULT_CONFIG["statsIntervalMinutes"]))
        except Exception:
            interval_min = DEFAULT_CONFIG["statsIntervalMinutes"]

        interval_sec = max(60, interval_min * 60)
        if stats_thread_stop.wait(interval_sec):
            break


def daily_backup():
    """Kopia devices.json, config.json i statystyk z poprzedniego dnia."""
    today = datetime.now().strftime("%Y%m%d")
    BACKUPS_DIR.mkdir(exist_ok=True)

    copied = []

    if DATA_FILE.exists():
        target = BACKUPS_DIR / f"devices_{today}.json"
        shutil.copy2(DATA_FILE, target)
        copied.append(str(target.name))

    if CONFIG_FILE.exists():
        target = BACKUPS_DIR / f"config_{today}.json"
        shutil.copy2(CONFIG_FILE, target)
        copied.append(str(target.name))

    yesterday = (datetime.now() - timedelta(days=1)).strftime("%Y-%m-%d")
    stats_file = STATS_DIR / f"stats_{yesterday}.json"
    if stats_file.exists():
        target = BACKUPS_DIR / f"stats_{yesterday}.json"
        shutil.copy2(stats_file, target)
        copied.append(str(target.name))

    return copied


def cleanup_old_backups(retention_days):
    """Usuwa kopie starsze niż X dni."""
    if not BACKUPS_DIR.exists():
        return 0
    cutoff = datetime.now() - timedelta(days=retention_days)
    removed = 0
    for old_file in BACKUPS_DIR.glob("*"):
        if not old_file.is_file():
            continue
        try:
            mtime = datetime.fromtimestamp(old_file.stat().st_mtime)
            if mtime < cutoff:
                old_file.unlink(missing_ok=True)
                removed += 1
        except OSError:
            pass
    return removed


def backup_worker():
    """Wątek sprawdzający czas co minutę i robiący backup w wyznaczonej godzinie."""
    if backup_thread_stop.wait(15):
        return

    last_run_date = None

    while not backup_thread_stop.is_set():
        try:
            config = read_config()
            if config.get("backupEnabled"):
                now = datetime.now()
                target_hour = int(config.get("backupHour", DEFAULT_CONFIG["backupHour"]))
                target_minute = int(config.get("backupMinute", DEFAULT_CONFIG["backupMinute"]))
                today = now.strftime("%Y-%m-%d")

                if now.hour == target_hour and now.minute == target_minute and last_run_date != today:
                    copied = daily_backup()
                    retention = int(config.get("backupRetentionDays", DEFAULT_CONFIG["backupRetentionDays"]))
                    removed = cleanup_old_backups(retention)
                    last_run_date = today
                    log_change("system", "auto-backup", f"skopiowano: {', '.join(copied)}; usunieto starych: {removed}")
                    print(f"[backup] Auto-backup wykonany ({len(copied)} plików, usunięto {removed} starych)")
        except Exception as error:
            print(f"[backup] Błąd: {error}")

        if backup_thread_stop.wait(60):
            break

# ============================================================
# HANDLER HTTP
# ============================================================
class Handler(SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def send_json(self, payload, status=200, extra_headers=None):
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        for header_name, header_value in (extra_headers or {}).items():
            self.send_header(header_name, header_value)
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        parsed = urlparse(self.path)

        if parsed.path == "/api/devices":
            devices = [enrich_device(device) for device in read_devices()]
            version = compute_file_version(DATA_FILE)
            extra_headers = {"X-Devices-Version": version} if version else {}
            self.send_json(devices, extra_headers=extra_headers)
            return

        if parsed.path == "/api/config":
            config = read_config()
            self.send_json({
                "areas": config["areas"],
                "types": config["types"],
                "groups": config["groups"],
                "siteCodes": AREAS,
                "sshUser": config.get("sshUser", ""),
                "vncLocalPort": config.get("vncLocalPort", DEFAULT_CONFIG["vncLocalPort"]),
                "vncRemotePort": config.get("vncRemotePort", DEFAULT_CONFIG["vncRemotePort"]),
                "vncViewerPath": config.get("vncViewerPath", ""),
                "statsEnabled": config.get("statsEnabled", DEFAULT_CONFIG["statsEnabled"]),
                "statsIntervalMinutes": config.get("statsIntervalMinutes", DEFAULT_CONFIG["statsIntervalMinutes"]),
                "statsRetentionDays": config.get("statsRetentionDays", DEFAULT_CONFIG["statsRetentionDays"]),
                "statsPingConcurrency": config.get("statsPingConcurrency", DEFAULT_CONFIG["statsPingConcurrency"]),
                "backupEnabled": config.get("backupEnabled", DEFAULT_CONFIG["backupEnabled"]),
                "backupHour": config.get("backupHour", DEFAULT_CONFIG["backupHour"]),
                "backupMinute": config.get("backupMinute", DEFAULT_CONFIG["backupMinute"]),
                "backupRetentionDays": config.get("backupRetentionDays", DEFAULT_CONFIG["backupRetentionDays"]),
            })
            return

        if parsed.path == "/api/ping":
            params = parse_qs(parsed.query)
            target = params.get("target", params.get("ip", [""]))[0].strip()
            if not target:
                self.send_json({"error": "Brak celu pingowania"}, status=400)
                return
            try:
                count = int(params.get("count", ["3"])[0])
            except (TypeError, ValueError):
                count = 3
            if count < 1:
                count = 1
            if count > 10:
                count = 10
            self.send_json(ping_host(target, count=count))
            return

        if parsed.path == "/api/ping-name":
            params = parse_qs(parsed.query)
            name = params.get("name", [""])[0].strip()
            if not name:
                self.send_json({"error": "Brak nazwy urzadzenia"}, status=400)
                return
            device = find_device_by_name(name)
            if not device:
                self.send_json({"error": "Nie znaleziono urzadzenia"}, status=404)
                return
            target = device_ping_target(device)
            result = ping_host(target)
            result["device"] = device
            self.send_json(result)
            return

        if parsed.path == "/api/stats/dates":
            dates = []
            if STATS_DIR.exists():
                for stats_file in sorted(STATS_DIR.glob("stats_*.json"), reverse=True):
                    name = stats_file.stem.replace("stats_", "")
                    if re.match(r"^\d{4}-\d{2}-\d{2}$", name):
                        dates.append(name)
            self.send_json({"dates": dates})
            return

        if parsed.path == "/api/stats":
            params = parse_qs(parsed.query)
            date = params.get("date", [""])[0].strip()

            if not date:
                date = datetime.now().strftime("%Y-%m-%d")

            if not re.match(r"^\d{4}-\d{2}-\d{2}$", date):
                self.send_json({"error": "Niepoprawny format daty (YYYY-MM-DD)"}, status=400)
                return

            stats_file = STATS_DIR / f"stats_{date}.json"
            if not stats_file.exists():
                self.send_json({"date": date, "devices": {}, "empty": True})
                return

            try:
                with stats_file.open("r", encoding="utf-8") as file:
                    data = json.load(file)
                self.send_json(data)
            except (OSError, json.JSONDecodeError) as error:
                self.send_json({"error": f"Nie udało się wczytać statystyk: {error}"}, status=500)
            return

        if parsed.path == "/":
            self.path = "/index.html"

        return super().do_GET()

        return super().do_GET()

    def do_POST(self):
        parsed = urlparse(self.path)
        if parsed.path not in [
            "/api/devices",
            "/api/config",
            "/api/ssh-tunnel",
            "/api/vnc-direct",
            "/api/ssh-raw",
            "/api/vnc-raw",
            "/api/network-scan",
            "/api/port-scan",
            "/api/wol",
            "/api/traceroute",
            "/api/stats/run-now",
            "/api/stats/backup-now",
        ]:
            self.send_json({"error": "Nieznany endpoint"}, status=404)
            return

        length = int(self.headers.get("Content-Length", "0"))
        try:
            payload = json.loads(self.rfile.read(length).decode("utf-8"))
        except json.JSONDecodeError:
            self.send_json({"error": "Niepoprawny JSON"}, status=400)
            return

        if not require_password(self, payload):
            return

        client_ip = self.client_address[0]

        if parsed.path == "/api/config":
            config = write_config(payload.get("config", payload))
            log_change(client_ip, "zapis konfiguracji")
            self.send_json({"ok": True, "config": config})
            return

        if parsed.path == "/api/ssh-tunnel":
            name = str(payload.get("name", "")).strip()
            if not name:
                self.send_json({"error": "Brak nazwy urzadzenia"}, status=400)
                return
            device = find_device_by_name(name)
            if not device:
                self.send_json({"error": "Nie znaleziono urzadzenia"}, status=404)
                return

            config = read_config()
            ssh_user = str(payload.get("sshUser") or config.get("sshUser") or "").strip()
            local_port = parse_port(payload.get("localPort"), config.get("vncLocalPort", DEFAULT_CONFIG["vncLocalPort"]))
            remote_port = parse_port(payload.get("remotePort"), config.get("vncRemotePort", DEFAULT_CONFIG["vncRemotePort"]))

            result = launch_ssh_tunnel(device, ssh_user, local_port, remote_port)
            if not result.get("ok"):
                log_change(client_ip, "tunel SSH - blad", f"{name}: {result.get('error', '')}")
                self.send_json({"error": result.get("error", "Nie udalo sie uruchomic SSH")}, status=500)
                return

            log_change(client_ip, "tunel SSH", f"{name} -> {result['target']}")
            message = (
                f"Uruchomiono SSH do {result['target']} w nowym oknie. "
                f"Wpisz haslo w tym oknie, a potem polacz sie VNC-em na localhost:{result['localPort']}."
            )
            self.send_json({"ok": True, "message": message, **result})
            return

        if parsed.path == "/api/vnc-direct":
            name = str(payload.get("name", "")).strip()
            if not name:
                self.send_json({"error": "Brak nazwy urzadzenia"}, status=400)
                return
            device = find_device_by_name(name)
            if not device:
                self.send_json({"error": "Nie znaleziono urzadzenia"}, status=404)
                return

            config = read_config()
            vnc_path = find_vnc_viewer(config.get("vncViewerPath", ""))

            if device.get("type") == "terminal":
                port = parse_port(payload.get("localPort"), config.get("vncLocalPort", DEFAULT_CONFIG["vncLocalPort"]))
                target_host = "localhost"
            else:
                port = parse_port(payload.get("remotePort"), config.get("vncRemotePort", DEFAULT_CONFIG["vncRemotePort"]))
                target_host = device.get("name") if device.get("addressMode") == "dhcp" else (device.get("ip") or device.get("name"))

            result = launch_vnc(vnc_path, target_host, port, device.get("vncUsername", ""))
            if not result.get("ok"):
                log_change(client_ip, "VNC - blad", f"{name}: {result.get('error', '')}")
                self.send_json({"error": result.get("error", "Nie udalo sie uruchomic VNC")}, status=500)
                return

            log_change(client_ip, "VNC", f"{name} -> {result['target']}")
            self.send_json({"ok": True, "message": f"Otwarto TigerVNC do {result['target']}.", **result})
            return

        if parsed.path == "/api/ssh-raw":
            host = str(payload.get("host", "")).strip()
            if not host:
                self.send_json({"error": "Brak hosta"}, status=400)
                return

            config = read_config()
            ssh_user = str(payload.get("sshUser", "") or "").strip()
            if not ssh_user:
                ssh_user = str(config.get("sshUser", "") or "").strip()

            local_port = parse_port(payload.get("localPort"), config.get("vncLocalPort", DEFAULT_CONFIG["vncLocalPort"]))
            remote_port = parse_port(payload.get("remotePort"), config.get("vncRemotePort", DEFAULT_CONFIG["vncRemotePort"]))

            result = launch_ssh_raw(host, local_port, remote_port, ssh_user)
            if not result.get("ok"):
                log_change(client_ip, "SSH raw - blad", f"{host}: {result.get('error', '')}")
                self.send_json({"error": result.get("error", "Nie udalo sie uruchomic SSH")}, status=500)
                return

            log_change(client_ip, "SSH raw", f"{ssh_user + '@' if ssh_user else ''}{host}")
            self.send_json({
                "ok": True,
                "message": f"Uruchomiono SSH do {result['target']} w nowym oknie. Wpisz hasło w tym oknie.",
                **result,
            })
            return

        if parsed.path == "/api/vnc-raw":
            host = str(payload.get("host", "")).strip()
            if not host:
                self.send_json({"error": "Brak hosta"}, status=400)
                return

            config = read_config()
            vnc_path = find_vnc_viewer(config.get("vncViewerPath", ""))
            port = parse_port(payload.get("remotePort"), config.get("vncRemotePort", DEFAULT_CONFIG["vncRemotePort"]))

            result = launch_vnc_raw(vnc_path, host, port)
            if not result.get("ok"):
                log_change(client_ip, "VNC raw - blad", f"{host}: {result.get('error', '')}")
                self.send_json({"error": result.get("error", "Nie udalo sie uruchomic VNC")}, status=500)
                return

            log_change(client_ip, "VNC raw", host)
            self.send_json({"ok": True, "message": f"Otwarto TigerVNC do {result['target']}.", **result})
            return

        if parsed.path == "/api/stats/run-now":
            result = stats_ping_cycle()
            log_change(client_ip, "statystyki - cykl ręczny", f"{result.get('online', 0)} online / {result.get('offline', 0)} offline")
            self.send_json(result)
            return

        if parsed.path == "/api/stats/backup-now":
            try:
                copied = daily_backup()
                config = read_config()
                retention = int(config.get("backupRetentionDays", DEFAULT_CONFIG["backupRetentionDays"]))
                removed = cleanup_old_backups(retention)
                log_change(client_ip, "backup - ręczny", f"skopiowano: {', '.join(copied)}")
                self.send_json({"ok": True, "copied": copied, "removed": removed})
            except Exception as error:
                self.send_json({"error": str(error)}, status=500)
            return
        if parsed.path == "/api/traceroute":
            host = str(payload.get("host", "")).strip()
            if not host:
                self.send_json({"error": "Brak hosta"}, status=400)
                return

            try:
                max_hops = int(payload.get("maxHops", 15))
            except (TypeError, ValueError):
                max_hops = 15
            if max_hops < 1:
                max_hops = 1
            if max_hops > 30:
                max_hops = 30

            result = run_traceroute(host, max_hops=max_hops)
            if not result.get("ok"):
                log_change(client_ip, "traceroute - blad", f"{host}: {result.get('error', '')}")
                self.send_json({"error": result.get("error", "Nie udało się wykonać traceroute")}, status=500)
                return

            log_change(client_ip, "traceroute", f"{host}: {len(result['hops'])} hopów")
            self.send_json(result)
            return
        if parsed.path == "/api/port-scan":
            host = str(payload.get("host", "")).strip()
            if not host:
                self.send_json({"error": "Brak hosta"}, status=400)
                return

            ports_payload = payload.get("ports", [])
            if not isinstance(ports_payload, list) or len(ports_payload) == 0:
                self.send_json({"error": "Brak listy portów"}, status=400)
                return

            ports = []
            for p in ports_payload[:64]:
                try:
                    port_num = int(p)
                    if 1 <= port_num <= 65535:
                        ports.append(port_num)
                except (TypeError, ValueError):
                    continue

            if not ports:
                self.send_json({"error": "Żaden port nie był prawidłowy"}, status=400)
                return

            results = scan_ports(host, ports)
            log_change(client_ip, "skan portów", f"{host}: {sum(1 for s in results.values() if s == 'open')} otwartych z {len(ports)}")
            self.send_json({"host": host, "results": results})
            return

        if parsed.path == "/api/wol":
            mac = str(payload.get("mac", "")).strip()
            if not mac:
                self.send_json({"error": "Brak adresu MAC"}, status=400)
                return

            broadcast = str(payload.get("broadcast", "")).strip() or "255.255.255.255"
            result = send_wol(mac, broadcast)

            if not result.get("ok"):
                log_change(client_ip, "WOL - blad", f"{mac}: {result.get('error', '')}")
                self.send_json({"error": result.get("error", "Nie udało się wysłać WOL")}, status=500)
                return

            log_change(client_ip, "WOL", f"MAC {mac}")
            self.send_json({"ok": True, "message": f"Wysłano magic packet do {mac}."})
            return

        if parsed.path == "/api/network-scan":
            range_str = str(payload.get("range", "")).strip()

            try:
                ip_list = parse_ip_range(range_str)
            except ValueError as error:
                self.send_json({"error": str(error)}, status=400)
                return

            devices = read_devices()

            known_ips = {
                device.get("ip", "").strip()
                for device in devices
                if device.get("ip", "").strip()
            }

            client_known_ips = payload.get("knownDhcpIps", [])
            if isinstance(client_known_ips, list):
                known_ips.update(str(ip).strip() for ip in client_known_ips if str(ip).strip())

            known_names = {
                device.get("name", "").strip().upper()
                for device in devices
                if device.get("name", "").strip()
            }

            online = scan_network(ip_list)
            results = []
            for ip, info in sorted(online.items(), key=lambda item: tuple(int(p) for p in item[0].split("."))):
                hostname = info.get("hostname")
                in_database = ip in known_ips or bool(hostname and hostname.strip().upper() in known_names)
                results.append({
                    "ip": ip,
                    "latencyMs": info.get("latencyMs"),
                    "hostname": hostname,
                    "inDatabase": in_database,
                })

            log_change(client_ip, "skan sieci", f"zakres {range_str}, {len(ip_list)} adresow, {len(results)} online")
            self.send_json({"scanned": len(ip_list), "online": results})
            return

        devices_payload = payload.get("devices", payload)
        if not isinstance(devices_payload, list):
            self.send_json({"error": "Lista urzadzen jest wymagana"}, status=400)
            return

        devices = [enrich_device(device) for device in devices_payload]
        seen_names = set()
        for device in devices:
            if not device.get("name"):
                self.send_json({"error": "Nazwa jest wymagana"}, status=400)
                return
            if device.get("addressMode") == "static" and not device.get("ip"):
                self.send_json({"error": f"Stale IP wymaga adresu: {device['name']}"}, status=400)
                return
            if device["name"] in seen_names:
                self.send_json({"error": f"Duplikat nazwy: {device['name']}"}, status=400)
                return
            seen_names.add(device["name"])

        client_version = payload.get("version")
        with WRITE_LOCK:
            current_version = compute_file_version(DATA_FILE)
            if client_version and current_version and client_version != current_version:
                self.send_json({
                    "error": "Ktos inny zapisal zmiany w miedzyczasie. Odswiez liste (przycisk Odswiez) "
                             "i wprowadz swoje zmiany ponownie, zeby nie nadpisac cudzej pracy.",
                    "conflict": True,
                }, status=409)
                return

            write_devices(devices)
            new_version = compute_file_version(DATA_FILE)

        log_change(client_ip, "zapis urzadzen", f"{len(devices)} urzadzen")
        self.send_json(
            {"ok": True, "count": len(devices)},
            extra_headers={"X-Devices-Version": new_version} if new_version else {},
        )


if __name__ == "__main__":
    if not DATA_DIR.exists():
        print(f"BLAD: folder z danymi nie istnieje: {DATA_DIR}")
        print("Sprawdz sciezke w zmiennej DEVICE_PANEL_DATA_DIR albo umiesc pliki obok app.py.")
        raise SystemExit(1)

    if "--set-password" in sys.argv:
        print("Zmiana hasla administratora.")
        new_password = prompt_new_password()
        new_salt, new_digest = hash_password(new_password)
        atomic_write_json(PASSWORD_FILE, {"salt": new_salt, "hash": new_digest})
        print(f"Haslo zostalo zmienione i zapisane w: {PASSWORD_FILE}")
        raise SystemExit(0)

    ADMIN_SALT, ADMIN_HASH = load_or_create_password_file()

    devices_backup = backup_file_on_startup(DATA_FILE)
    config_backup = backup_file_on_startup(CONFIG_FILE)

    STATS_DIR.mkdir(exist_ok=True)
    BACKUPS_DIR.mkdir(exist_ok=True)

    stats_thread = threading.Thread(target=stats_worker, daemon=True, name="stats-worker")
    stats_thread.start()

    backup_thread = threading.Thread(target=backup_worker, daemon=True, name="backup-worker")
    backup_thread.start()

    server = ThreadingHTTPServer(("0.0.0.0", PORT), Handler)
    print(f"Panel urzadzen dziala: http://localhost:{PORT}")
    print(f"Statystyki: wlaczone w konfiguracji (plik: {STATS_DIR})")
    print(f"Auto-backup: o {DEFAULT_CONFIG['backupHour']:02d}:{DEFAULT_CONFIG['backupMinute']:02d} (domyslnie)")
    print("W sieci lokalnej uzyj adresu IP tego komputera i portu 5000.")
    print(f"Dane czytane/zapisywane w: {DATA_FILE}")
    if devices_backup:
        print(f"Kopia zapasowa devices.json: {devices_backup}")
    if config_backup:
        print(f"Kopia zapasowa config.json: {config_backup}")
    server.serve_forever()
