from flask import Flask, render_template, request, redirect, url_for, session
from flask_socketio import SocketIO, emit
import socket as sock

app = Flask(__name__)
app.secret_key = 'supersecretkey'
socketio = SocketIO(app, cors_allowed_origins="*")

clients = {}         # sid -> name
sockets_by_name = {} # name -> sid
public_keys = {}     # sid -> public key (JWK string)

@app.route('/', methods=['GET', 'POST'])
def login():
    if request.method == 'POST':
        session['name'] = request.form['name']
        session['server_ip'] = request.form['server_ip']
        session['server_port'] = request.form['server_port']
        return redirect(url_for('chat'))
    return render_template('login.html')

@app.route('/chat')
def chat():
    if 'name' not in session:
        return redirect(url_for('login'))
    return render_template('chat.html', name=session['name'])

@socketio.on('connect')
def handle_connect():
    print(f"[CONNECTED] {request.sid}")
    # Send the list of online users to the newly connected client
    emit('users_updated', list(clients.values()), broadcast=True)

@socketio.on('register')
def handle_register(data):
    clients[request.sid] = data['name']
    sockets_by_name[data['name']] = request.sid
    public_keys[request.sid] = data['publicKey']
    print(f"[REGISTER] {data['name']} ({request.sid})")
    emit('users_updated', list(clients.values()), broadcast=True)

@socketio.on('exchange_keys')
def handle_key_exchange(target_user):
    if target_user in sockets_by_name:
        emit('peer_key', {
            'user': clients[request.sid],
            'key': public_keys[request.sid]
        }, room=sockets_by_name[target_user])

# @socketio.on('send_message')
# def handle_message(data):
#     print(f"[ENCRYPTION] Encrypted message from {clients[request.sid]}: {str(data['ciphertext'])[:60]}...")
#     emit('message', {
#         'sender': clients[request.sid],
#         'ciphertext': data['ciphertext'],
#         'nonce': data.get('nonce', '')
#     }, room=sockets_by_name[data['recipient']])

@socketio.on('send_message')
def handle_message(data):
    sender = clients[request.sid]
    recipient = data.get('recipient')
    ciphertext = data.get('ciphertext')
    nonce = data.get('nonce')
    plaintext = data.get('plaintext')
    log = data.get('log', {})

    # Log encryption (sent from client)
    print("\nEncrypting Message:")
    print("Plaintext:", log.get('plaintext'))
    print("Nonce:", log.get('nonce'))
    print("Ciphertext:", log.get('ciphertext'))
    print("Final Encrypted Data:", log.get('finalData'), "\n")

    # Simulated server-side decryption log
    print("Decrypting Message:")
    print("Nonce:", nonce)
    print("Ciphertext:", ciphertext)
    print("Plaintext:", plaintext)
    print(f"[MESSAGE] {sender}: {plaintext}\n")

    # Send to recipient
    recipient_sid = sockets_by_name.get(recipient)
    if recipient_sid:
        emit('message', {
            'sender': sender,
            'ciphertext': ciphertext,
            'nonce': nonce
        }, room=recipient_sid)

        # Echo back to sender
        emit('message', {
            'sender': sender,
            'ciphertext': ciphertext,
            'nonce': nonce
        }, room=request.sid)
    else:
        print(f"[ERROR] {recipient} is not online.")


@socketio.on('disconnect')
def handle_disconnect():
    if request.sid in clients:
        name = clients.pop(request.sid)
        sockets_by_name.pop(name, None)
        public_keys.pop(request.sid, None)
        print(f"[DISCONNECT] {name}")
        emit('users_updated', list(clients.values()), broadcast=True)

if __name__ == '__main__':
    hostname = sock.gethostname()
    local_ip = sock.gethostbyname(hostname)
    print(f"Web server running at http://{local_ip}:5000")
    socketio.run(app, host=local_ip, port=5000, debug=True)
