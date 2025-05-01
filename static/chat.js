// static/chat.js
let socket;
let selectedUser = null;
let myPrivateKey;
let sharedKeys = new Map();

const BUBBLE_STYLES = {
  outgoing: {
    background: '#007AFF',
    color: 'white',
    alignSelf: 'flex-end'
  },
  incoming: {
    background: '#F2F2F7',
    color: 'black',
    alignSelf: 'flex-start'
  }
};

window.onload = () => {
    initSocket();
    setupEventListeners();
};

function initSocket() {
    // Get server details from template variables
    const username = "{{ name }}";
    
    // Connect to the Flask-SocketIO server
    socket = io({
        transports: ['websocket'],
        forceNew: true
    });
    
    socket.on('connect', async () => {
        console.log("✅ Connected to server");
        await setupEncryption();
    });
    
    socket.on('connect_error', (error) => {
        console.error('Connection error:', error);
    });
    
    // Handle server events
    socket.on('users_updated', (users) => {
        updateUserList(users);
    });
    
    socket.on('peer_key', async (data) => {
        try {
            const { user, key } = data;
            await handlePeerKey(user, key);
        } catch (error) {
            console.error('Error processing peer key:', error);
        }
    });
    
    socket.on('message', async (data) => {
        try {
            const { sender, ciphertext, nonce } = data;
            await decryptAndDisplayMessage(sender, ciphertext, nonce);
        } catch (error) {
            console.error('Error processing message:', error);
        }
    });
}

async function setupEncryption() {
    try {
        // Generate ECDH key pair
        const keyPair = await window.crypto.subtle.generateKey(
            { name: "ECDH", namedCurve: "P-256" },
            true,
            ["deriveKey"]
        );
        
        myPrivateKey = keyPair.privateKey;
        
        // Export public key for sharing
        const publicKey = await window.crypto.subtle.exportKey("jwk", keyPair.publicKey);
        
        // Register with server
        socket.emit('register', {
            name: "{{ name }}",
            publicKey: JSON.stringify(publicKey)
        });
    } catch (error) {
        console.error('Encryption setup failed:', error);
    }
}

async function handlePeerKey(user, publicKeyHex) {
    try {
        const publicKey = await importPublicKey(JSON.parse(publicKeyHex));
        const sharedKey = await deriveSharedKey(publicKey);
        sharedKeys.set(user, sharedKey);
        console.log(`🔑 Shared key established with ${user}`);
    } catch (error) {
        console.error(`Failed to establish shared key with ${user}:`, error);
    }
}

async function importPublicKey(jwk) {
    return window.crypto.subtle.importKey(
        "jwk",
        jwk,
        { name: "ECDH", namedCurve: "P-256" },
        true,
        []
    );
}

async function deriveSharedKey(peerPublicKey) {
    return window.crypto.subtle.deriveKey(
        { name: "ECDH", public: peerPublicKey },
        myPrivateKey,
        { name: "ChaCha20-Poly1305", length: 256 },
        true,
        ["encrypt", "decrypt"]
    );
}

async function decryptAndDisplayMessage(sender, ciphertext, nonce) {
    try {
        const sharedKey = sharedKeys.get(sender);
        if (!sharedKey) {
            throw new Error(`No shared key available for ${sender}`);
        }
        
        const decrypted = await window.crypto.subtle.decrypt(
            { name: "ChaCha20-Poly1305", iv: new Uint8Array(nonce) },
            sharedKey,
            new Uint8Array(ciphertext)
        );
        
        const message = new TextDecoder().decode(decrypted);
        displayMessage(message, false, sender);
    } catch (error) {
        console.error('Message decryption failed:', error);
        alert('🔒 Failed to decrypt message');
    }
}

async function sendMessage() {
    const input = document.getElementById('messageInput');
    const message = input.value.trim();
    
    if (!message || !selectedUser) {
        if (!selectedUser) alert('Please select a user first');
        return;
    }

    try {
        const sharedKey = sharedKeys.get(selectedUser);
        if (!sharedKey) {
            throw new Error(`No shared key available for ${selectedUser}`);
        }
        
        // Generate nonce for ChaCha20-Poly1305
        const nonce = window.crypto.getRandomValues(new Uint8Array(12));
        
        // Encrypt the message
        const ciphertext = await window.crypto.subtle.encrypt(
            { name: "ChaCha20-Poly1305", iv: nonce },
            sharedKey,
            new TextEncoder().encode(message)
        );
        
        // Send encrypted message to server
        socket.emit('send_message', {
            recipient: selectedUser,
            ciphertext: Array.from(new Uint8Array(ciphertext)),
            nonce: Array.from(nonce)
        });
        
        // Display message in UI
        displayMessage(message, true);
        input.value = '';
    } catch (error) {
        console.error('Message encryption failed:', error);
        alert('Failed to send message');
    }
}

function displayMessage(text, isOutgoing, sender = 'You') {
    const messagesDiv = document.getElementById('messages');
    const timestamp = new Date().toLocaleTimeString([], { 
        hour: '2-digit', minute: '2-digit' 
    });
    
    const messageDiv = document.createElement('div');
    messageDiv.className = 'message-bubble';
    Object.assign(messageDiv.style, BUBBLE_STYLES[isOutgoing ? 'outgoing' : 'incoming']);
    
    messageDiv.innerHTML = `
        <div class="message-content">${isOutgoing ? text : `<strong>${sender}:</strong> ${text}`}</div>
        <div class="timestamp">${timestamp}</div>
        ${isOutgoing ? '<div class="read-receipt">✓✓</div>' : ''}
    `;

    messagesDiv.appendChild(messageDiv);
    messagesDiv.scrollTop = messagesDiv.scrollHeight;
}

function updateUserList(users) {
    const userList = document.getElementById('userList');
    userList.innerHTML = '';
    
    // Debug line to confirm users are received
    console.log("Received users:", users);
    
    users.forEach(user => {
        if (user !== "{{ name }}") {
            const li = document.createElement('li');
            li.textContent = user;
            li.onclick = () => selectUser(user);
            userList.appendChild(li);
        }
    });
}

function selectUser(user) {
    selectedUser = user;
    console.log("Selected user:", user);
    // Exchange keys with selected user
    socket.emit('exchange_keys', user);
    // Visual feedback
    alert(`Now chatting with ${user}`);
}

function selectUser(user) {
    selectedUser = user;
    
    // Highlight selected user
    document.querySelectorAll('#userList li').forEach(li => {
        li.className = li.textContent === user ? 'selected' : '';
    });
    
    // Exchange keys
    socket.emit('exchange_keys', user);
    console.log(`Selected user: ${user}`);
}

function setupEventListeners() {
    // Set up UI event listeners
    document.getElementById('sendButton').onclick = sendMessage;
    document.getElementById('messageInput').addEventListener('keydown', e => {
        if (e.key === 'Enter') sendMessage();
    });
}
