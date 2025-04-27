from flask import Flask, render_template, request, redirect, url_for, session
import socket
import threading
import secure_crypto as crypto

app = Flask(__name__)
app.secret_key = 'supersecretkey'

BUFFER_SIZE = 4096
CLIENT = None
SHARED_KEY = None

# Background thread to receive messages
def receive_messages():
    while True:
        try:
            data = CLIENT.recv(BUFFER_SIZE)
            if not data:
                break
            decrypted = crypto.decrypt_message(SHARED_KEY, data)
            session['messages'].append(decrypted)
        except:
            break

@app.route('/', methods=['GET', 'POST'])
def login():
    if request.method == 'POST':
        host = request.form['host']
        port = int(request.form['port'])
        name = request.form['name']
        
        global CLIENT, SHARED_KEY
        CLIENT = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        CLIENT.connect((host, port))
        
        private_key, public_key = crypto.generate_dh_key_pair()
        CLIENT.send(crypto.serialize_public_key(public_key))
        peer_bytes = CLIENT.recv(BUFFER_SIZE)
        peer_public_key = crypto.deserialize_public_key(peer_bytes)
        SHARED_KEY = crypto.derive_shared_key(private_key, peer_public_key)

        session['name'] = name
        session['messages'] = []

        threading.Thread(target=receive_messages, daemon=True).start()

        return redirect(url_for('chat'))
    return render_template('login.html')

@app.route('/chat', methods=['GET', 'POST'])
def chat():
    if request.method == 'POST':
        msg = request.form['message']
        full_msg = f"{session['name']}: {msg}"
        encrypted = crypto.encrypt_message(SHARED_KEY, full_msg)
        CLIENT.send(encrypted)
        session['messages'].append(full_msg)
    return render_template('chat.html', messages=session.get('messages', []))

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000, debug=True)
