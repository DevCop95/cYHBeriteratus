import argparse
import os
import signal
import socket
import subprocess
import sys
import time
from pathlib import Path


ROOT = Path(__file__).resolve().parent
PID_FILE = ROOT / ".server.pid"
LOG_FILE = ROOT / "server.log"
HOST = "127.0.0.1"
PORT = int(os.environ.get("APP_PORT", "4000"))


def is_port_open(host: str, port: int, timeout: float = 0.5) -> bool:
    if os.name == "nt":
        return get_port_pid(port) is not None

    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.settimeout(timeout)
        return sock.connect_ex((host, port)) == 0


def read_pid() -> int | None:
    try:
        return int(PID_FILE.read_text(encoding="utf-8").strip())
    except (FileNotFoundError, ValueError):
        return None


def write_pid(pid: int) -> None:
    PID_FILE.write_text(str(pid), encoding="utf-8")


def clear_pid() -> None:
    if PID_FILE.exists():
        PID_FILE.unlink()


def process_exists(pid: int) -> bool:
    if os.name == "nt":
        result = subprocess.run(
            ["tasklist", "/FI", f"PID eq {pid}"],
            capture_output=True,
            text=True,
            check=False,
        )
        return str(pid) in result.stdout

    try:
        os.kill(pid, 0)
        return True
    except OSError:
        return False


def get_port_pid(port: int) -> int | None:
    if os.name == "nt":
        result = subprocess.run(
            ["netstat", "-ano", "-p", "tcp"],
            capture_output=True,
            text=True,
            check=False,
        )
        needle = f"{HOST}:{port}"

        for line in result.stdout.splitlines():
            if "LISTENING" not in line or needle not in line:
                continue

            parts = line.split()
            if len(parts) >= 5:
                try:
                    return int(parts[-1])
                except ValueError:
                    return None
        return None

    result = subprocess.run(
        ["lsof", "-ti", f"tcp:{port}"],
        capture_output=True,
        text=True,
        check=False,
    )
    output = result.stdout.strip().splitlines()
    if not output:
        return None
    try:
        return int(output[0])
    except ValueError:
        return None


def start_server() -> int:
    pid = read_pid()

    if pid and process_exists(pid):
        print(f"Servidor ya activo con PID {pid} en http://{HOST}:{PORT}")
        return 0

    if is_port_open(HOST, PORT):
        clear_pid()
        print(
            f"El puerto {PORT} ya esta ocupado por otro proceso. "
            f"Libera el puerto o usa APP_PORT para otro valor."
        )
        return 1

    creation_flags = 0
    startup_info = None

    if os.name == "nt":
        creation_flags = subprocess.CREATE_NEW_PROCESS_GROUP | subprocess.DETACHED_PROCESS
        startup_info = subprocess.STARTUPINFO()
        startup_info.dwFlags |= subprocess.STARTF_USESHOWWINDOW

    with LOG_FILE.open("ab") as log_handle:
        process = subprocess.Popen(
            ["node", "server.js"],
            cwd=ROOT,
            stdout=log_handle,
            stderr=log_handle,
            stdin=subprocess.DEVNULL,
            creationflags=creation_flags,
            startupinfo=startup_info,
        )

    for _ in range(20):
        if is_port_open(HOST, PORT):
            write_pid(process.pid)
            print(f"Servidor iniciado con PID {process.pid} en http://{HOST}:{PORT}")
            return 0
        if process.poll() is not None:
            break
        time.sleep(0.3)

    print("No se pudo iniciar el servidor. Revisa server.log")
    return 1


def stop_server() -> int:
    pid = read_pid()

    if not pid:
        port_pid = get_port_pid(PORT)
        if port_pid:
            pid = port_pid
            print(f"Deteniendo proceso en puerto {PORT} con PID {pid}...")
        elif is_port_open(HOST, PORT):
            print(f"Hay algo escuchando en {HOST}:{PORT}, pero no pude resolver su PID.")
            return 1
        else:
            print("No hay servidor registrado para detener.")
            return 0

    if not process_exists(pid):
        clear_pid()
        print("El PID registrado ya no existe. Archivo limpiado.")
        return 0

    try:
        if os.name == "nt":
            subprocess.run(
                ["taskkill", "/PID", str(pid), "/F", "/T"],
                check=True,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
            )
        else:
            os.kill(pid, signal.SIGTERM)
    except Exception as exc:
        print(f"No se pudo detener el servidor: {exc}")
        return 1

    clear_pid()
    print(f"Servidor detenido. PID {pid}")
    return 0


def status_server() -> int:
    pid = read_pid()
    port_open = is_port_open(HOST, PORT)
    port_pid = get_port_pid(PORT)

    if pid and process_exists(pid) and port_open:
        print(f"ONLINE | PID {pid} | http://{HOST}:{PORT}")
        return 0

    if port_open and port_pid:
        print(f"PUERTO OCUPADO | PID {port_pid} | http://{HOST}:{PORT} | sin PID gestionado")
        return 0

    if port_open:
        print(f"PUERTO OCUPADO | http://{HOST}:{PORT} | sin PID gestionado")
        return 0

    print("OFFLINE")
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description="Control del server Node hacker UI.")
    parser.add_argument("command", choices=["start", "stop", "status", "restart"])
    args = parser.parse_args()

    if args.command == "start":
        return start_server()
    if args.command == "stop":
        return stop_server()
    if args.command == "status":
        return status_server()
    if args.command == "restart":
        stop_server()
        return start_server()

    return 1


if __name__ == "__main__":
    sys.exit(main())
