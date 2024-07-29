// Copyright (c) Microsoft. All rights reserved.
// Licensed under the MIT license.

// Global objects
var speechRecognizer
var avatarSynthesizer
var peerConnection
var messages = []
var messageInitiated = false
var dataSources = []
var sentenceLevelPunctuations = ['.', '?', '!', ':', ';', '。', '？', '！', '：', '；']
var enableQuickReply = false
var quickReplies = ['Let me take a look.', 'Let me check.', 'One moment, please.']
var byodDocRegex = new RegExp(/\[doc(\d+)\]/g)
var isSpeaking = false
var spokenTextQueue = []
var sessionActive = false
var lastSpeakTime
var imgUrl = ""
var finalCart = []
var menuOpen = false;

async function fetchInitialMessage() {
    document.getElementById('menu').style.visibility = 'visible';
    document.getElementById('menu').removeAttribute('hidden');
    if (menuOpen == false){
        generateMenu();
        menuOpen = true;
    };
    const azureOpenAIEndpoint = "https://justin-openai-demo.openai.azure.com/";
    const azureOpenAIApiKey = "1a1f8c2855a44483bbd3ef4c838996c8";
    const azureOpenAIDeploymentName = "justin-gpt-4o";

    let url = `${azureOpenAIEndpoint}/openai/deployments/${azureOpenAIDeploymentName}/chat/completions?api-version=2023-06-01-preview`;
    let body = JSON.stringify({
        messages: [
            {
                role: 'system',
                content: "You are a MacDonald manager to take orders from customers. You can only take orders for [big mac, cheeseburger, milo and coke]."
            },
            {
                role: 'user',
                content: "Greet the customer Justin and ask how you can help them."
            }
        ]
    });

    try {
        let response = await fetch(url, {
            method: 'POST',
            headers: {
                'api-key': azureOpenAIApiKey,
                'Content-Type': 'application/json'
            },
            body: body
        });

        if (!response.ok) {
            throw new Error(`Chat API response status: ${response.status} ${response.statusText}`);
        }

        let responseData = await response.json();
        return responseData.choices[0].message.content;
    } catch (error) {
        console.error("Error fetching initial message:", error);
        return "Welcome! How can I help you today?";
    }
}


// Connect to avatar service
// Connect to avatar service
async function connectAvatar() {
    const cogSvcRegion = "westus2";
    const cogSvcSubKey = "27506bcd68114a929ef02cacc8f6b279";
    if (cogSvcSubKey === '') {
        alert('Please fill in the subscription key of your speech resource.');
        return;
    }

    const privateEndpointEnabled = false;
    const privateEndpoint = "";

    if (privateEndpointEnabled && privateEndpoint === '') {
        alert('Please fill in the Azure Speech endpoint.');
        return;
    }

    let speechSynthesisConfig;
    if (privateEndpointEnabled) {
        speechSynthesisConfig = SpeechSDK.SpeechConfig.fromEndpoint(new URL(`wss://${privateEndpoint}/tts/cognitiveservices/websocket/v1?enableTalkingAvatar=true`), cogSvcSubKey);
    } else {
        speechSynthesisConfig = SpeechSDK.SpeechConfig.fromSubscription(cogSvcSubKey, cogSvcRegion);
    }

    speechSynthesisConfig.endpointId = "";

    const talkingAvatarCharacter = "lisa";
    const talkingAvatarStyle = "casual-sitting";

    const avatarConfig = new SpeechSDK.AvatarConfig(talkingAvatarCharacter, talkingAvatarStyle);

    avatarSynthesizer = new SpeechSDK.AvatarSynthesizer(speechSynthesisConfig, avatarConfig);
    avatarSynthesizer.avatarEventReceived = function (s, e) {
        var offsetMessage = ", offset from session start: " + e.offset / 10000 + "ms.";
        if (e.offset === 0) {
            offsetMessage = "";
        }

        console.log("Event received: " + e.description + offsetMessage);
    };

    const speechRecognitionConfig = SpeechSDK.SpeechConfig.fromEndpoint(new URL(`wss://${cogSvcRegion}.stt.speech.microsoft.com/speech/universal/v2`), cogSvcSubKey);
    speechRecognitionConfig.setProperty(SpeechSDK.PropertyId.SpeechServiceConnection_LanguageIdMode, "Continuous");
    var sttLocales = ["en-US", "de-DE", "es-ES", "fr-FR", "it-IT", "ja-JP", "ko-KR", "zh-CN"];
    var autoDetectSourceLanguageConfig = SpeechSDK.AutoDetectSourceLanguageConfig.fromLanguages(sttLocales);

    speechRecognizer = SpeechSDK.SpeechRecognizer.FromConfig(speechRecognitionConfig, autoDetectSourceLanguageConfig, SpeechSDK.AudioConfig.fromDefaultMicrophoneInput());

    const azureOpenAIEndpoint = "https://justin-openai-demo.openai.azure.com/";
    const azureOpenAIApiKey = "1a1f8c2855a44483bbd3ef4c838996c8";
    const azureOpenAIDeploymentName = "justin-gpt-4o";

    if (azureOpenAIEndpoint === '' || azureOpenAIApiKey === '' || azureOpenAIDeploymentName === '') {
        alert('Please fill in the Azure OpenAI endpoint, API key and deployment name.');
        return;
    }

    dataSources = [];

    // Only initialize messages once
    if (!messageInitiated) {
        initMessages();
        messageInitiated = true;
    }

    document.getElementById('startSession').disabled = true;

    const xhr = new XMLHttpRequest();
    if (privateEndpointEnabled) {
        xhr.open("GET", `https://${privateEndpoint}/tts/cognitiveservices/avatar/relay/token/v1`);
    } else {
        xhr.open("GET", `https://${cogSvcRegion}.tts.speech.microsoft.com/cognitiveservices/avatar/relay/token/v1`);
    }
    xhr.setRequestHeader("Ocp-Apim-Subscription-Key", cogSvcSubKey);
    xhr.addEventListener("readystatechange", function () {
        if (this.readyState === 4) {
            const responseData = JSON.parse(this.responseText);
            const iceServerUrl = responseData.Urls[0];
            const iceServerUsername = responseData.Username;
            const iceServerCredential = responseData.Password;
            setupWebRTC(iceServerUrl, iceServerUsername, iceServerCredential);
        }
    });
    xhr.send();

    // Fetch and display the initial message
    const initialMessage = await fetchInitialMessage();
    addMessage('bot', initialMessage);
}


// Disconnect from avatar service
function disconnectAvatar() {
    if (avatarSynthesizer !== undefined) {
        avatarSynthesizer.close()
    }

    if (speechRecognizer !== undefined) {
        speechRecognizer.stopContinuousRecognitionAsync()
        speechRecognizer.close()
    }

    sessionActive = false
}


function showCart(){
    console.log("Opening shopping cart!")
    document.getElementById('cartTab').style.visibility = 'visible';
    document.getElementById('cartTab').classList.add('open');
    document.getElementById('cartTab').classList.remove('close');
    document.body.classList.add('cart-open');
}


function hideCart(){
    console.log("Hiding shopping cart!")
    document.getElementById('cartTab').style.visibility = 'hidden';
    document.getElementById('cartTab').classList.remove('open');
    document.getElementById('cartTab').classList.add('close');
    document.body.classList.remove('cart-open');
}
function updateCartCount() {
    const cartCountElement = document.getElementById('cartCount');
    const totalItems = finalCart.reduce((acc, item) => acc + item.quantity, 0);
    cartCountElement.textContent = totalItems;
}

// Setup WebRTC
function setupWebRTC(iceServerUrl, iceServerUsername, iceServerCredential) {
    // Create WebRTC peer connection
    peerConnection = new RTCPeerConnection({
        iceServers: [{
            urls: [iceServerUrl],
            username: iceServerUsername,
            credential: iceServerCredential
        }]
    })

    // Fetch WebRTC video stream and mount it to an HTML video element
    peerConnection.ontrack = function (event) {
        if (event.track.kind === 'audio') {
            let audioElement = document.createElement('audio')
            audioElement.id = 'audioPlayer'
            audioElement.srcObject = event.streams[0]
            audioElement.autoplay = true

            audioElement.onplaying = () => {
                console.log(`WebRTC ${event.track.kind} channel connected.`)
            }

            document.getElementById('remoteVideo').appendChild(audioElement)
        }

        if (event.track.kind === 'video') {
            let videoElement = document.createElement('video')
            videoElement.id = 'videoPlayer'
            videoElement.srcObject = event.streams[0]
            videoElement.autoplay = true
            videoElement.playsInline = true

            videoElement.onplaying = () => {
                // Clean up existing video element if there is any
                remoteVideoDiv = document.getElementById('remoteVideo')
                for (var i = 0; i < remoteVideoDiv.childNodes.length; i++) {
                    if (remoteVideoDiv.childNodes[i].localName === event.track.kind) {
                        remoteVideoDiv.removeChild(remoteVideoDiv.childNodes[i])
                    }
                }

                // Append the new video element
                document.getElementById('remoteVideo').appendChild(videoElement)

                console.log(`WebRTC ${event.track.kind} channel connected.`)
                document.getElementById('microphone').disabled = false
                document.getElementById('stopSession').disabled = false
                document.getElementById('remoteVideo').style.width = '900px'
                document.getElementById('chatHistory').style.visibility = 'visible';
                document.getElementById('chatHistoryHeader').style.visibility = 'visible';
                document.getElementById('chatHistoryContent').style.visibility = 'visible';

                // Remove the 'hidden' attribute if it's set
                document.getElementById('chatHistory').removeAttribute('hidden');
                document.getElementById('chatHistoryHeader').removeAttribute('hidden');
                document.getElementById('chatHistoryContent').removeAttribute('hidden');
                document.getElementById('cartIcon').removeAttribute('hidden');
                document.getElementById('cartIcon').style.visibility = 'visible';
                document.getElementById('menu').style.visibility = 'visible';
                document.getElementById('menu').removeAttribute('hidden');
                document.getElementById('chatHistoryHeader').style.visibility = 'visible';
                document.getElementById('instructionsBox').style.visibility = 'visible';
                document.getElementById('instructionsBox').removeAttribute('hidden');
                document.getElementById('chatHistoryContent').style.visibility = 'visible';
                document.getElementById('cartDisplay').hidden = false
                document.getElementById('menu').hidden = false
                document.getElementById('showTypeMessage').disabled = false


                setTimeout(() => { sessionActive = true }, 5000) // Set session active after 5 seconds
            }
        }
    }

    // Make necessary update to the web page when the connection state changes
    peerConnection.oniceconnectionstatechange = e => {
        console.log("WebRTC status: " + peerConnection.iceConnectionState)
        if (peerConnection.iceConnectionState === 'disconnected') {
            if (document.getElementById('useLocalVideoForIdle').checked) {
                document.getElementById('localVideo').hidden = false
                document.getElementById('remoteVideo').style.width = '0.1px'
            }
        }
    }

    // Offer to receive 1 audio, and 1 video track
    peerConnection.addTransceiver('video', { direction: 'sendrecv' })
    peerConnection.addTransceiver('audio', { direction: 'sendrecv' })

    // start avatar, establish WebRTC connection
    avatarSynthesizer.startAvatarAsync(peerConnection).then((r) => {
        if (r.reason === SpeechSDK.ResultReason.SynthesizingAudioCompleted) {
            console.log("[" + (new Date()).toISOString() + "] Avatar started. Result ID: " + r.resultId)
        } else {
            console.log("[" + (new Date()).toISOString() + "] Unable to start avatar. Result ID: " + r.resultId)
            if (r.reason === SpeechSDK.ResultReason.Canceled) {
                let cancellationDetails = SpeechSDK.CancellationDetails.fromResult(r)
                if (cancellationDetails.reason === SpeechSDK.CancellationReason.Error) {
                    console.log(cancellationDetails.errorDetails)
                };

                console.log("Unable to start avatar: " + cancellationDetails.errorDetails);
            }
            document.getElementById('startSession').disabled = false;
        }
    }).catch(
        (error) => {
            console.log("[" + (new Date()).toISOString() + "] Avatar failed to start. Error: " + error)
            document.getElementById('startSession').disabled = false
        }
    )
}

// Initialize messages
function initMessages() {
    messages = []

    if (dataSources.length === 0) {
        let systemPrompt = "You are a MacDonald manager to take orders from customers. 1) If the customer tells you he would like swap menus, reply swapping menus. 2) If the customer tells you to swap to x menu, reply swapping to x menu. E.g Swap to drinks menu. Response: Swapping to drinks menu 3) Take orders from customers. You can only take orders for Drinks in [Coca-Cola, Milo, Orange Juice, Coffee, Tea]. You can only take orders for Food in [Big Mac, Cheeseburger, Chicken Nuggets, Fries, Salad]. 4) After the customer has said something, just ask him if he would like anything else, no need to repeat the menu again. Example: Customer: I would like 1 big mac. Response: 1 big mac, anything else? 5) Remove customer's ordered items. If the customer wants to remove items, you can also remove items from the cart that the user has oredered or remove specific items from the cart if the user tells you to do so. E.g The customer says I would like 1 Cheeseburger removed or remove cheeseburger. Tell him that 1 cheeseburger has been removed from the cart, depending on the quantity in numbers. 6) If what the customer says is not part of the items that you are trained on, tell them that 'Sorry, I couldn't catch your order. Could you please repeat it for me? Please refer to the menu on the right!' unless they are telling to clear their cart or remove an item for their cart or swapping menus. 7) You do not have to give them  the items that you take orders for. If the customer says he has nothing else to order, say 'Please proceed with checkout'. 8) If the user says Clear Cart or anything along the lines or clearing cart, repeat back 'Cart has been cleared' Nothing else is to be included in the message 9) If the user says Show Cart or show shopping cart, you reply Cart has been displayed 10) If the user says Hide Cart or hide shopping cart, you reply Cart has been hidden 11) If the user wants to view help or anything similiar, say help has been displayed";
             let systemMessage = {
            role: 'system',
            content: systemPrompt
        }

        messages.push(systemMessage)
    }
}

// Set data sources for chat API
function setDataSources(azureCogSearchEndpoint, azureCogSearchApiKey, azureCogSearchIndexName) {
    let dataSource = {
        type: 'AzureCognitiveSearch',
        parameters: {
            endpoint: azureCogSearchEndpoint,
            key: azureCogSearchApiKey,
            indexName: azureCogSearchIndexName,
            semanticConfiguration: '',
            queryType: 'simple',
            fieldsMapping: {
                contentFieldsSeparator: '\n',
                contentFields: ['content'],
                filepathField: null,
                titleField: 'title',
                urlField: null
            },
            inScope: true,
            roleInformation: document.getElementById('prompt').value
        }
    }

    dataSources.push(dataSource)
}

// Do HTML encoding on given text
function htmlEncode(text) {
    const entityMap = {
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;',
        '/': '&#x2F;'
    };

    return String(text).replace(/[&<>"'\/]/g, (match) => entityMap[match])
}

// Speak the given text
function speak(text, endingSilenceMs = 0) {
    if (isSpeaking) {
        spokenTextQueue.push(text)
        return
    }

    speakNext(text, endingSilenceMs)
}

// Function to extract quantity from text
function extractQuantity(text) {
    let quantity = 1; // Default quantity if not specified
    const regex = /\b(\d{1,3})\b/; // Regex to match 1 to 3 digits in the text
    const match = text.match(regex); // Try to find a number in the text
    if (match) {
        quantity = parseInt(match[0]); // Parse the matched number as integer
        if (quantity < 1) {
            quantity = 1; // Ensure quantity is at least 1 if matched number is less than 1
        } else if (quantity > 999) {
            quantity = 999; // Cap quantity at 999 if matched number exceeds 999
        }
    }
    return quantity;
}function addToCartFromMenu(itemName, itemPrice, quantityInputId) {
    // Get the quantity from the input box
    let quantityInput = document.getElementById(quantityInputId);
    let quantity = quantityInputId;
    
    // Check if quantity is valid
    if (isNaN(quantity) || quantity <= 0) {
        alert('Please enter a valid quantity.');
        return;
    }
    
    // Add item to cart
    addToCart(itemName, itemPrice, `Quantity: ${quantity}`);
     
}


function addToCart(itemName, itemPrice, lowerText) {
    let quantity = extractQuantity(lowerText);
    // Check if item already exists in cart
    let existingItem = finalCart.find(item => item.name.toLowerCase() === itemName.toLowerCase());
    if (existingItem) {
        existingItem.quantity += quantity; // Update quantity if item exists
    } else {
        finalCart.push({ name: itemName, price: itemPrice, quantity: quantity }); // Add new item to cart
    }
    updateCartDisplay(); // Update cart display
 
}

function emptyCart() {
    const cartItems = document.getElementById('listCart');
    cartItems.innerHTML = '';
    finalCart = [];
    updateCartDisplay(); 
}
function removeItem(itemName) {
    let quantityToRemove = extractQuantity(lowerText);
    // Find the item in the cart
    let existingItem = finalCart.find(item => item.name.toLowerCase() === itemName.toLowerCase());

    if (existingItem) {
        if (existingItem.quantity <= quantityToRemove) {
            // If there's not enough quantity, remove the item completely
            finalCart = finalCart.filter(item => item.name.toLowerCase() !== itemName.toLowerCase());
        } else {
            // Otherwise, just reduce the quantity
            existingItem.quantity -= quantityToRemove;
        }
        updateCartDisplay(); // Update cart display
    }
}function speakNext(text, endingSilenceMs = 0) {
    let ttsVoice = document.getElementById('ttsVoice').value;
    let personalVoiceSpeakerProfileID = document.getElementById('personalVoiceSpeakerProfileID').value;
    let ssml = `<speak version='1.0' xmlns='http://www.w3.org/2001/10/synthesis' xmlns:mstts='http://www.w3.org/2001/mstts' xml:lang='en-US'><voice name='${ttsVoice}'><mstts:ttsembedding speakerProfileId='${personalVoiceSpeakerProfileID}'><mstts:leadingsilence-exact value='0'/>${htmlEncode(text)}</mstts:ttsembedding></voice></speak>`;
    if (endingSilenceMs > 0) {
        ssml = `<speak version='1.0' xmlns='http://www.w3.org/2001/10/synthesis' xmlns:mstts='http://www.w3.org/2001/mstts' xml:lang='en-US'><voice name='${ttsVoice}'><mstts:ttsembedding speakerProfileId='${personalVoiceSpeakerProfileID}'><mstts:leadingsilence-exact value='0'/>${htmlEncode(text)}<break time='${endingSilenceMs}ms' /></mstts:ttsembedding></voice></speak>`;
    }

    lastSpeakTime = new Date();
    isSpeaking = true;
    document.getElementById('stopSpeaking').disabled = false;
    avatarSynthesizer.speakSsmlAsync(ssml).then(
        (result) => {
            if (result.reason === SpeechSDK.ResultReason.SynthesizingAudioCompleted) {
                console.log(`Speech synthesized to speaker for text [ ${text} ]. Result ID: ${result.resultId}`);
                lastSpeakTime = new Date();
                var lowerText = text.toLowerCase();
                console.log("Lower text is " + lowerText);
                // Check for empty cart command
                if (lowerText.includes("help has been displayed")) {
                    alert("Commands:\nOrder food: I would like 1 Cheeseburger\nRemove food: Remove 1 Milo\nShow cart: Show my cart\nHide Cart: Hide my cart\nSwap to Food/Drink Menu: Swap my menu to food/drink menu\nClear Cart: Please clear my cart.");
                    return;
                }
                // Check for empty cart command
                if (lowerText.includes("cart has been cleared") || lowerText.includes("cart emptied")) {
                    emptyCart();
                    return;
                }
                if (lowerText.includes('cart has been hidden')){ 
                    hideCart();
                    return;
                } 
                if (lowerText.includes('cart has been displayed')){ 
                    showCart();
                    return;
                }  
                // Detect removal
                if (lowerText.includes('removed')) {
                    const removedPattern = /(\d+)\s*(\w+)\s*has\s*been\s*removed/;
                    const match = lowerText.match(removedPattern);
                    if (match) {
                        const quantity = parseInt(match[1], 10);
                        const product = match[2];
                        removeFromCart(product, quantity);
                    }
                } else if (lowerText.includes('swapping to drinks menu')) {
                    openMenu({ currentTarget: document.getElementById('defaultOpen') }, 'Drinks');
                } else if (lowerText.includes('swapping to food menu')) {
                    openMenu({ currentTarget: document.querySelector('.tablink:not(#defaultOpen)') }, 'Food');
                } 
                else {
                    // Loop through drinks and food menu items to add to cart
                    for (const category of Object.keys(menuItems)) {
                        for (const item of menuItems[category]) {
                            if (lowerText.includes(item.name.toLowerCase())) {
                                // Swap to the relevant tab before adding the item
                                if (category === 'drinks') {
                                    openMenu({ currentTarget: document.getElementById('defaultOpen') }, 'Drinks');
                                } else if (category === 'food') {
                                    openMenu({ currentTarget: document.querySelector('.tablink:not(#defaultOpen)') }, 'Food');
                                }
                                addToCart(item.name, item.price, lowerText);
                            }
                        }
                    }
                }

                updateCartDisplay();
            } else {
                console.log(`Error occurred while speaking the SSML. Result ID: ${result.resultId}`);
            }

            if (spokenTextQueue.length > 0) {
                speakNext(spokenTextQueue.shift());
            } else {
                isSpeaking = false;
                document.getElementById('stopSpeaking').disabled = true;
            }

        }).catch(
            (error) => {
                console.log(`Error occurred while speaking the SSML: [ ${error} ]`);

                if (spokenTextQueue.length > 0) {
                    speakNext(spokenTextQueue.shift());
                } else {
                    isSpeaking = false;
                    document.getElementById('stopSpeaking').disabled = true;
                }
            }
        );
}

function openMenu(evt, menuName) {
    var i, tabcontent, tablinks;

    tabcontent = document.getElementsByClassName("tabcontent");
    for (i = 0; i < tabcontent.length; i++) {
        tabcontent[i].style.display = "none";
    }

    tablinks = document.getElementsByClassName("tablink");
    for (i = 0; i < tablinks.length; i++) {
        tablinks[i].style.backgroundColor = "";
    }

    document.getElementById(menuName).style.display = "block";
    document.getElementById(menuName).style.display = "grid";
    evt.currentTarget.style.backgroundColor = 'red';
}


function openMenu(evt, menuName) {
    var i, tabcontent, tablinks;

    tabcontent = document.getElementsByClassName("tabcontent");
    for (i = 0; i < tabcontent.length; i++) {
        tabcontent[i].style.display = "none";
    }

    tablinks = document.getElementsByClassName("tablink");
    for (i = 0; i < tablinks.length; i++) {
        tablinks[i].style.backgroundColor = "";
    }

    document.getElementById(menuName).style.display = "block";
    document.getElementById(menuName).style.display = "grid";
    evt.currentTarget.style.backgroundColor = 'red';
}


function removeFromCart(product, quantity) {
    // Find the item in the cart
    console.log("hi")
    let existingItem = finalCart.find(item => item.name.toLowerCase() === product.toLowerCase());

    if (existingItem) {
        if (existingItem.quantity <= quantity) {
            // If there's not enough quantity, remove the item completely
            finalCart = finalCart.filter(item => item.name.toLowerCase() !== product.toLowerCase());
        } else {
            // Otherwise, just reduce the quantity
            existingItem.quantity -= quantity;
        }
        updateCartDisplay(); // Update cart display
    }
}

function stopSpeaking() {
    spokenTextQueue = []
    avatarSynthesizer.stopSpeakingAsync().then(
        () => {
            isSpeaking = false
            document.getElementById('stopSpeaking').disabled = true
            console.log("[" + (new Date()).toISOString() + "] Stop speaking request sent.")
        }
    ).catch(
        (error) => {
            console.log("Error occurred while stopping speaking: " + error)
        }
    )
}


// chat.js

// chat.js

function addMessage(speaker, text, imgUrlPath = '') {
    let chatHistoryTextArea = document.getElementById('chatHistoryContent');
    let messageDiv = document.createElement('div');
    messageDiv.className = `message ${speaker} new-message`; // Add animation class

    let bubbleDiv = document.createElement('div');
    bubbleDiv.className = 'bubble';
    bubbleDiv.innerHTML = imgUrlPath.trim() ? imgUrlPath.trim() + text : text;

    let iconDiv = document.createElement('div');
    iconDiv.className = 'icon';

    let iconImg = document.createElement('img');
    iconImg.className = 'speaker-icon';
    iconImg.src = speaker === 'user' ? 'image/user-icon.png' : 'image/bot-icon.png'; // Path to the user and bot icons

    iconDiv.appendChild(iconImg);

    if (speaker === 'user') {
        messageDiv.appendChild(bubbleDiv);
        messageDiv.appendChild(iconDiv);
    } else {
        messageDiv.appendChild(iconDiv);
        messageDiv.appendChild(bubbleDiv);
    }

    chatHistoryTextArea.appendChild(messageDiv);
    chatHistoryTextArea.scrollTop = chatHistoryTextArea.scrollHeight;

    // Remove animation class after animation ends
    messageDiv.addEventListener('animationend', () => {
        messageDiv.classList.remove('new-message');
    });
}

function handleUserQuery(userQuery, userQueryHTML, imgUrlPath) {
    let contentMessage = userQuery
    if (imgUrlPath.trim()) {
        contentMessage = [
            {
                "type": "text",
                "text": userQuery
            },
            {
                "type": "image_url",
                "image_url": {
                    "url": imgUrlPath
                }
            }
        ]
    }
    let chatMessage = {
        role: 'user',
        content: contentMessage
    }

    messages.push(chatMessage)
    let chatHistoryTextArea = document.getElementById('chatHistoryContent')
    if (chatHistoryTextArea.innerHTML !== '' && !chatHistoryTextArea.innerHTML.endsWith('\n\n')) {
        chatHistoryTextArea.innerHTML += '\n\n'
    }
    addMessage('user', userQueryHTML, userQuery)
    // chatHistoryTextArea.innerHTML += imgUrlPath.trim() ? "<br/><br/>You: " + userQueryHTML : "<br/><br/>You: " + userQuery + "<br/>";

    chatHistoryTextArea.scrollTop = chatHistoryTextArea.scrollHeight

    // Stop previous speaking if there is any
    if (isSpeaking) {
        stopSpeaking()
    }

    // For 'bring your data' scenario, chat API currently has long (4s+) latency
    // We return some quick reply here before the chat API returns to mitigate.
    if (dataSources.length > 0 && enableQuickReply) {
        speak(getQuickReply(), 2000)
    }

    const azureOpenAIEndpoint = "https://justin-openai-demo.openai.azure.com/";
    const azureOpenAIApiKey = "1a1f8c2855a44483bbd3ef4c838996c8";
    const azureOpenAIDeploymentName = "justin-gpt-4o";

    let url = "{AOAIEndpoint}/openai/deployments/{AOAIDeployment}/chat/completions?api-version=2023-06-01-preview".replace("{AOAIEndpoint}", azureOpenAIEndpoint).replace("{AOAIDeployment}", azureOpenAIDeploymentName)
    let body = JSON.stringify({
        messages: messages,
        stream: true
    })

    if (dataSources.length > 0) {
        url = "{AOAIEndpoint}/openai/deployments/{AOAIDeployment}/extensions/chat/completions?api-version=2023-06-01-preview".replace("{AOAIEndpoint}", azureOpenAIEndpoint).replace("{AOAIDeployment}", azureOpenAIDeploymentName)
        body = JSON.stringify({
            dataSources: dataSources,
            messages: messages,
            stream: true
        })
    }

    let assistantReply = ''
    let toolContent = ''
    let spokenSentence = ''
    let displaySentence = ''

    fetch(url, {
        method: 'POST',
        headers: {
            'api-key': azureOpenAIApiKey,
            'Content-Type': 'application/json'
        },
        body: body
    })
        .then(response => {
            if (!response.ok) {
                throw new Error(`Chat API response status: ${response.status} ${response.statusText}`)
            }

            let chatHistoryTextArea = document.getElementById('chatHistoryContent')

            //chatHistoryTextArea.innerHTML += imgUrlPath.trim() ? 'MacDonald: ':'<br/>MacDonald: '

            const reader = response.body.getReader()

            // Function to recursively read chunks from the stream
            function read(previousChunkString = '') {
                return reader.read().then(({ value, done }) => {
                    // Check if there is still data to read
                    if (done) {
                        // Stream complete
                        return
                    }

                    // Process the chunk of data (value)
                    let chunkString = new TextDecoder().decode(value, { stream: true })
                    if (previousChunkString !== '') {
                        // Concatenate the previous chunk string in case it is incomplete
                        chunkString = previousChunkString + chunkString
                    }

                    if (!chunkString.endsWith('}\n\n') && !chunkString.endsWith('[DONE]\n\n')) {
                        // This is a incomplete chunk, read the next chunk
                        return read(chunkString)
                    }

                    chunkString.split('\n\n').forEach((line) => {
                        try {
                            if (line.startsWith('data:') && !line.endsWith('[DONE]')) {
                                const responseJson = JSON.parse(line.substring(5).trim())
                                let responseToken = undefined
                                if (dataSources.length === 0) {
                                    responseToken = responseJson.choices[0].delta.content
                                } else {
                                    let role = responseJson.choices[0].messages[0].delta.role
                                    if (role === 'tool') {
                                        toolContent = responseJson.choices[0].messages[0].delta.content
                                    } else {
                                        responseToken = responseJson.choices[0].messages[0].delta.content
                                        if (responseToken !== undefined) {
                                            if (byodDocRegex.test(responseToken)) {
                                                responseToken = responseToken.replace(byodDocRegex, '').trim()
                                            }

                                            if (responseToken === '[DONE]') {
                                                responseToken = undefined
                                            }
                                        }
                                    }
                                }

                                if (responseToken !== undefined && responseToken !== null) {
                                    assistantReply += responseToken // build up the assistant message
                                    displaySentence += responseToken // build up the display sentence

                                    // console.log(`Current token: ${responseToken}`)

                                    if (responseToken === '\n' || responseToken === '\n\n') {
                                        speak(spokenSentence.trim())
                                        spokenSentence = ''
                                    } else {
                                        responseToken = responseToken.replace(/\n/g, '')
                                        spokenSentence += responseToken // build up the spoken sentence

                                        if (responseToken.length === 1 || responseToken.length === 2) {
                                            for (let i = 0; i < sentenceLevelPunctuations.length; ++i) {
                                                let sentenceLevelPunctuation = sentenceLevelPunctuations[i]
                                                if (responseToken.startsWith(sentenceLevelPunctuation)) {
                                                    speak(spokenSentence.trim())
                                                    spokenSentence = ''
                                                    break
                                                }
                                            }
                                        }
                                    }
                                }
                            }
                        } catch (error) {
                            console.log(`Error occurred while parsing the response: ${error}`)
                            console.log(chunkString)
                        }
                    })

                    // chatHistoryTextArea.innerHTML += `${displaySentence}`
                    if (displaySentence.trim() != '') {
                        addMessage('bot', displaySentence, '')
                    }
                    chatHistoryTextArea.scrollTop = chatHistoryTextArea.scrollHeight

                    displaySentence = ''

                    // Continue reading the next chunk
                    return read()
                })
            }

            // Start reading the stream
            return read()
        })
        .then(() => {
            if (spokenSentence !== '') {
                speak(spokenSentence.trim())
                spokenSentence = ''
            }

            if (dataSources.length > 0) {
                let toolMessage = {
                    role: 'tool',
                    content: toolContent
                }

                messages.push(toolMessage)
            }

            let assistantMessage = {
                role: 'assistant',
                content: assistantReply
            }

            messages.push(assistantMessage)
        })
}

function getQuickReply() {
    return quickReplies[Math.floor(Math.random() * quickReplies.length)]
}

function checkHung() {
    // Check whether the avatar video stream is hung, by checking whether the video time is advancing
    let videoElement = document.getElementById('videoPlayer')
    if (videoElement !== null && videoElement !== undefined && sessionActive) {
        let videoTime = videoElement.currentTime
        setTimeout(() => {
            // Check whether the video time is advancing
            if (videoElement.currentTime === videoTime) {
                // Check whether the session is active to avoid duplicatedly triggering reconnect
                if (sessionActive) {
                    sessionActive = false
                    if (document.getElementById('autoReconnectAvatar').checked) {
                        console.log(`[${(new Date()).toISOString()}] The video stream got disconnected, need reconnect.`)
                        connectAvatar()
                    }
                }
            }
        }, 2000)
    }
}

function checkLastSpeak() {
    if (lastSpeakTime === undefined) {
        return
    }

    let currentTime = new Date()
    if (currentTime - lastSpeakTime > 15000) {
        if (document.getElementById('useLocalVideoForIdle').checked && sessionActive && !isSpeaking) {
            disconnectAvatar()
            document.getElementById('localVideo').hidden = false
            document.getElementById('remoteVideo').style.width = '0.1px'
            sessionActive = false
        }
    }
}

window.startSession = () => {
    connectAvatar();
}

window.stopSession = () => {
    document.getElementById('startSession').disabled = false
    document.getElementById('microphone').disabled = true
    document.getElementById('stopSession').disabled = true
    document.getElementById('chatHistory').hidden = true
    document.getElementById('chatHistoryHeader').hidden = true
    document.getElementById('chatHistoryContent').hidden = true
    document.getElementById('cartDisplay').hidden = true
    document.getElementById('menu').hidden = true
    document.getElementById('showTypeMessage').checked = false
    document.getElementById('showTypeMessage').disabled = true
    document.getElementById('userMessageBox').hidden = true
    document.getElementById('uploadImgIcon').hidden = true
    document.getElementById('videoContainer').hidden = true
    if (document.getElementById('useLocalVideoForIdle').checked) {
        document.getElementById('localVideo').hidden = true
    }

    disconnectAvatar()
}

window.clearChatHistory = () => {
    const chatHistoryContent = document.getElementById('chatHistoryContent');
    chatHistoryContent.classList.add('shake'); // Add animation class
    chatHistoryContent.addEventListener('animationend', () => {
        chatHistoryContent.classList.remove('shake');
        chatHistoryContent.innerHTML = '';
        initMessages();
    });
}

window.microphone = () => {
    if (document.getElementById('microphone').innerHTML === 'Stop Microphone') {
        // Stop microphone
        document.getElementById('microphone').disabled = true
        speechRecognizer.stopContinuousRecognitionAsync(
            () => {
                document.getElementById('microphone').innerHTML = 'Start Microphone'
                document.getElementById('microphone').disabled = false
            }, (err) => {
                console.log("Failed to stop continuous recognition:", err)
                document.getElementById('microphone').disabled = false
            })

        return
    }



    document.getElementById('microphone').disabled = true
    speechRecognizer.recognized = async (s, e) => {
        if (e.result.reason === SpeechSDK.ResultReason.RecognizedSpeech) {
            let userQuery = e.result.text.trim()
            if (userQuery === '') {
                return
            }

            // Auto stop microphone when a phrase is recognized, when it's not continuous conversation mode
            if (!document.getElementById('continuousConversation').checked) {
                document.getElementById('microphone').disabled = true
                speechRecognizer.stopContinuousRecognitionAsync(
                    () => {
                        document.getElementById('microphone').innerHTML = 'Start Microphone'
                        document.getElementById('microphone').disabled = false
                    }, (err) => {
                        console.log("Failed to stop continuous recognition:", err)
                        document.getElementById('microphone').disabled = false
                    })
            }

            handleUserQuery(userQuery, "", "")
        }
    }

    speechRecognizer.startContinuousRecognitionAsync(
        () => {
            document.getElementById('microphone').innerHTML = 'Stop Microphone'
            document.getElementById('microphone').disabled = false
        }, (err) => {
            console.log("Failed to start continuous recognition:", err)
            document.getElementById('microphone').disabled = false
        })
}

window.updataEnableOyd = () => {
    if (document.getElementById('enableOyd').checked) {
        document.getElementById('cogSearchConfig').hidden = false
    } else {
        document.getElementById('cogSearchConfig').hidden = true
    }
}

window.updateTypeMessageBox = () => {
    if (document.getElementById('showTypeMessage').checked) {
        document.getElementById('userMessageBox').hidden = false
        document.getElementById('uploadImgIcon').hidden = false
        document.getElementById('userMessageBox').addEventListener('keyup', (e) => {
            if (e.key === 'Enter') {
                const userQuery = document.getElementById('userMessageBox').innerText
                const messageBox = document.getElementById('userMessageBox')
                const childImg = messageBox.querySelector("#picInput")
                if (childImg) {
                    childImg.style.width = "200px"
                    childImg.style.height = "200px"
                }
                let userQueryHTML = messageBox.innerHTML.trim("")
                if (userQueryHTML.startsWith('<img')) {
                    userQueryHTML = "<br/>" + userQueryHTML
                }
                if (userQuery !== '') {
                    handleUserQuery(userQuery.trim(''), userQueryHTML, imgUrl)
                    document.getElementById('userMessageBox').innerHTML = ''
                    imgUrl = ""
                }
            }
        })
        document.getElementById('uploadImgIcon').addEventListener('click', function () {
            imgUrl = "https://samples-files.com/samples/Images/jpg/1920-1080-sample.jpg"
            const userMessage = document.getElementById("userMessageBox");
            const childImg = userMessage.querySelector("#picInput");
            if (childImg) {
                userMessage.removeChild(childImg)
            }
            userMessage.innerHTML += '<br/><img id="picInput" src="https://samples-files.com/samples/Images/jpg/1920-1080-sample.jpg" style="width:100px;height:100px"/><br/><br/>'
        });
    } else {
        document.getElementById('userMessageBox').hidden = true
        document.getElementById('uploadImgIcon').hidden = true
        imgUrl = ""
    }
}

window.updateLocalVideoForIdle = () => {
    if (document.getElementById('useLocalVideoForIdle').checked) {
        document.getElementById('showTypeMessageCheckbox').hidden = true
    } else {
        document.getElementById('showTypeMessageCheckbox').hidden = false
    }
}

window.updatePrivateEndpoint = () => {
    if (document.getElementById('enablePrivateEndpoint').checked) {
        document.getElementById('showPrivateEndpointCheckBox').hidden = false
    } else {
        document.getElementById('showPrivateEndpointCheckBox').hidden = true
    }
}

function updateCartDisplay() {
    updateCartCount();
    var cartItemsElement = document.querySelector('.listCart');
    cartItemsElement.innerHTML = ''; // Clear previous items

    var subtotal = 0;

    finalCart.forEach(function (item, index) {
        var cartItemDiv = document.createElement('div');
        cartItemDiv.className = 'cart-item';

        var img = document.createElement('img');
        img.src = getImageUrl(item.name); // Function to get image URL based on item name
        img.alt = item.name;

        var contentDiv = document.createElement('div');
        contentDiv.className = 'cart-item-content';

        var itemName = document.createElement('span');
        itemName.className = 'item-name';
        itemName.textContent = item.name;

        var itemPrice = document.createElement('span');
        itemPrice.className = 'item-price';
        itemPrice.textContent = `$${(item.price * item.quantity).toFixed(2)}`;

        var quantityDiv = document.createElement('div');
        quantityDiv.className = 'quantity-controls';

        var minusButton = document.createElement('button');
        minusButton.className = 'minus-button';
        minusButton.textContent = '-';
        minusButton.onclick = function () {
            updateItemQuantity(index, item.quantity - 1);
        };

        var quantitySpan = document.createElement('span');
        quantitySpan.className = 'quantity';
        quantitySpan.textContent = item.quantity;

        var plusButton = document.createElement('button');
        plusButton.className = 'plus-button';
        plusButton.textContent = '+';
        plusButton.onclick = function () {
            updateItemQuantity(index, item.quantity + 1);
        };

        quantityDiv.appendChild(minusButton);
        quantityDiv.appendChild(quantitySpan);
        quantityDiv.appendChild(plusButton);

        contentDiv.appendChild(itemName);
        contentDiv.appendChild(itemPrice);
        cartItemDiv.appendChild(img);
        cartItemDiv.appendChild(contentDiv);
        cartItemDiv.appendChild(quantityDiv);
        cartItemsElement.appendChild(cartItemDiv);

        subtotal += item.price * item.quantity;
    });

    var gst = subtotal * 0.07; // Assuming GST is 7%
    var grandTotal = subtotal + gst;

    // Create subtotal, GST, and grand total elements
    var summaryDiv = document.createElement('div');
    summaryDiv.className = 'cart-summary-container';

    var subtotalDiv = document.createElement('div');
    subtotalDiv.className = 'cart-summary';
    subtotalDiv.innerHTML = `<strong>Subtotal:</strong> $${subtotal.toFixed(2)}`;

    var gstDiv = document.createElement('div');
    gstDiv.className = 'cart-summary';
    gstDiv.innerHTML = `<strong>GST (7%):</strong> $${gst.toFixed(2)}`;

    var grandTotalDiv = document.createElement('div');
    grandTotalDiv.className = 'cart-summary';
    grandTotalDiv.innerHTML = `<strong>Grand Total:</strong> $${grandTotal.toFixed(2)}`;

    summaryDiv.appendChild(subtotalDiv);
    summaryDiv.appendChild(gstDiv);
    summaryDiv.appendChild(grandTotalDiv);

    // Append the summary container to the cart
    cartItemsElement.appendChild(summaryDiv);
}
function updateItemQuantity(index, newQuantity) {
    if (newQuantity < 1) {
        finalCart.splice(index, 1);
    } else {
        finalCart[index].quantity = newQuantity;
    }
    updateCartDisplay();
}
// Function to remove a quantity of an item from the cart

// Function to remove a quantity of an item from the cart
function removeItemFromCart(index, removeQuantity) {
    var item = finalCart[index];
    if (removeQuantity >= item.quantity) {
        finalCart.splice(index, 1);
    } else {
        item.quantity -= removeQuantity;
    }
    updateCartDisplay();
}
// Function to get image URL based on item name  
function getImageUrl(itemName) {
    switch (itemName.toLowerCase()) {
        case 'big mac':
            return './image/big_mac.png';
        case 'cheeseburger':
            return './image/cheeseburger.png';
        case 'coca-cola':
            return './image/coke.png';
        case 'milo':
            return './image/milo.png';
        case 'wagyu':
                return './image/wagyu.png';
        default:
            return './image/wagyu.png';
    }
}

function updateItemQuantity(index, newQuantity) {
    if (newQuantity < 1) {
        finalCart.splice(index, 1);
    } else {
        finalCart[index].quantity = newQuantity;
    }
    updateCartDisplay();
}

function calculateTotalCost() {
    return finalCart.reduce((total, item) => total + (item.price * item.quantity), 0);
}

function checkout() {
    const totalCost = calculateTotalCost();
    alert('Proceeding to checkout with items: ' + JSON.stringify(finalCart) + '\nTotal cost: $' + totalCost.toFixed(2));
}

var pfx = ["webkit", "moz", "MS", "o", ""],
    clicked = false,
    layers = [
        document.querySelector('.layer-1'),
        document.querySelector('.layer-2'),
        document.querySelector('.layer-3'),
        document.querySelector('.layer-4'),
    ],
    count = 0;


function PrefixedEvent(element, type, callback) {
    for (var p = 0; p < pfx.length; p++) {
        if (!pfx[p]) type = type.toLowerCase();
        element.addEventListener(pfx[p] + type, callback, false);
    }
}
function handleClick() {
    for (var i = 0; i < layers.length; i++) {
        PrefixedEvent(layers[i], "AnimationIteration", AnimationListener);
    }
    document.querySelector('.finish-loading').classList.add('disableButton');
}

function startSession() {  
    document.getElementById('chatHistory').style.visibility = 'visible';
    document.getElementById('chatHistoryHeader').style.visibility = 'visible';
    document.getElementById('chatHistoryContent').style.visibility = 'visible';
    document.getElementById('instructionsBox').style.visibility = 'visible';

    document.getElementById('chatHistory').removeAttribute('hidden');
    document.getElementById('chatHistoryHeader').removeAttribute('hidden');
    document.getElementById('chatHistoryContent').removeAttribute('hidden');
    document.getElementById('instructionsBox').removeAttribute('hidden');
}


function showHelpPopup() {
    document.getElementById('popup-content').style.visibility = 'visible';
}

function hideHelpPopup() {
    document.getElementById('popup-content').style.visibility = 'hidden';
}

// Function to show the help modal
function showHelpModal() {
    document.getElementById('helpModal').style.display = 'block';
}

// Function to hide the help modal
function hideHelpModal() {
    document.getElementById('helpModal').style.display = 'none';
} 
 
document.addEventListener('DOMContentLoaded', function() {
    document.getElementById("defaultOpen").click();
});

function openMenu(evt, menuName) {
    var i, tabcontent, tablinks;

    tabcontent = document.getElementsByClassName("tabcontent");
    for (i = 0; i < tabcontent.length; i++) {
        tabcontent[i].style.display = "none";
    }

    tablinks = document.getElementsByClassName("tablink");
    for (i = 0; i < tablinks.length; i++) {
        tablinks[i].style.backgroundColor = "";
    }

    document.getElementById(menuName).style.display = "block";
    document.getElementById(menuName).style.display = "grid";
    evt.currentTarget.style.backgroundColor = 'red';
}

const menuItems = {
    drinks: [ 
        { name: 'Coca-Cola', price: 1.99, image: './image/coke.png' },
        { name: 'Milo', price: 2.49, image: './image/milo.png' },
        { name: 'Orange Juice', price: 2.99, image: './image/orange_juice.png' },
        { name: 'Coffee', price: 1.49, image: './image/coffee.png' },
        { name: 'Tea', price: 1.29, image: './image/tea.png' }
    ],
    food: [ 
        { name: 'Big Mac', price: 6.99, image: './image/big_mac.png' },
        { name: 'Cheeseburger', price: 5.99, image: './image/cheeseburger.png' },
        { name: 'Chicken Nuggets', price: 4.99, image: './image/nuggets.png' },
        { name: 'Fries', price: 2.49, image: './image/fries.png' },
        { name: 'Salad', price: 3.99, image: './image/salad.png' }
    ]
};

function generateMenu() { 
    const drinksContainer = document.getElementById('Drinks');
    const foodContainer = document.getElementById('Food');
 

    menuItems.drinks.forEach(item => {
        drinksContainer.appendChild(createMenuItem(item));
    });

    menuItems.food.forEach(item => {
        foodContainer.appendChild(createMenuItem(item));
    });
}
function createMenuItem(item) {
    const itemDiv = document.createElement('div');
    itemDiv.className = 'menu-item';

    const itemImage = document.createElement('img');
    itemImage.src = item.image;
    itemImage.alt = item.name;

    const itemDetails = document.createElement('div');
    itemDetails.className = 'item-details';

    const itemName = document.createElement('h3');
    itemName.innerHTML = `${item.name} <br><span class="price">$${item.price.toFixed(2)}</span>`;

    const quantityInput = document.createElement('input');
    quantityInput.type = 'number';
    quantityInput.className = 'quantity-input';
    quantityInput.placeholder = 'Qty';
    quantityInput.min = 1;
    quantityInput.style.width = '60px';

    const addButton = document.createElement('button');
    addButton.textContent = 'Add to Cart';
    addButton.onclick = () => {
        const quantity = quantityInput.value;
        if (quantity && quantity > 0) {
            addToCart(item.name, item.price, quantity);
        } else {
            alert('Please enter a valid quantity');
        }
    };

    const quantityContainer = document.createElement('div');
    quantityContainer.className = 'quantity-container';
    quantityContainer.appendChild(quantityInput);
    quantityContainer.appendChild(addButton);

    itemDetails.appendChild(itemName);
    itemDetails.appendChild(quantityContainer);

    itemDiv.appendChild(itemImage);
    itemDiv.appendChild(itemDetails);

    return itemDiv;
}
window.onload = () => { 
    setInterval(() => {
        checkHung()
        checkLastSpeak()
    }, 2000) // Check session activity every 2 seconds
}