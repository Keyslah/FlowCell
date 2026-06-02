import socket
import threading
import traceback

HOST = "127.0.0.1"
PORT = 5555

def handle(conn, addr):
    try:
        data = conn.recv(1024 * 1024)
        if not data:
            conn.send(b"ERROR: No data received")
            return

        code = data.decode("utf-8", errors="replace")

        print(f"[CodexListener] Connection from {addr}")
        print(f"[CodexListener] Bytes received: {len(data)}")

        try:
            exec(code, globals())
            conn.send(b"OK")
        except Exception:
            err = traceback.format_exc()
            print("[CodexListener] EXEC ERROR:")
            print(err)
            conn.send(err.encode("utf-8"))

    except Exception:
        err = traceback.format_exc()
        print("[CodexListener] HANDLE CRASH:")
        print(err)
        try:
            conn.send(err.encode("utf-8"))
        except Exception:
            pass
    finally:
        try:
            conn.close()
        except Exception:
            pass

def server():
    s = None
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        s.bind((HOST, PORT))
        s.listen(5)
        print(f"[CodexListener] Blender listener running on {HOST}:{PORT}")

        while True:
            conn, addr = s.accept()
            threading.Thread(
                target=handle,
                args=(conn, addr),
                daemon=True
            ).start()

    except Exception:
        err = traceback.format_exc()
        print("[CodexListener] LISTENER CRASHED:")
        print(err)

    finally:
        if s:
            try:
                s.close()
            except Exception:
                pass

threading.Thread(target=server, daemon=True).start()
