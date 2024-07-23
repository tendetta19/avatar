// Copyright (c) Microsoft. All rights reserved.
// Licensed under the MIT license.

// Global objects
var speechRecognizer
var avatarSynthesizer
var peerConnection
var messages = []
var messageInitiated = false
var dataSources = []
var sentenceLevelPunctuations = [ '.', '?', '!', ':', ';', '。', '？', '！', '：', '；' ]
var enableQuickReply = false
var quickReplies = [ 'Let me take a look.', 'Let me check.', 'One moment, please.' ]
var byodDocRegex = new RegExp(/\[doc(\d+)\]/g)
var isSpeaking = false
var spokenTextQueue = []
var sessionActive = false
var lastSpeakTime
var imgUrl = ""
var finalCart = []

 

// Connect to avatar service
// Connect to avatar service
function connectAvatar() {
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
    var sttLocales = ["en-US","de-DE","es-ES","fr-FR","it-IT","ja-JP","ko-KR","zh-CN"];
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
    xhr.addEventListener("readystatechange", function() {
        if (this.readyState === 4) {
            const responseData = JSON.parse(this.responseText);
            const iceServerUrl = responseData.Urls[0];
            const iceServerUsername = responseData.Username;
            const iceServerCredential = responseData.Password;
            setupWebRTC(iceServerUrl, iceServerUsername, iceServerCredential);
        }
    });
    xhr.send();
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

// Setup WebRTC
function setupWebRTC(iceServerUrl, iceServerUsername, iceServerCredential) {
    // Create WebRTC peer connection
    peerConnection = new RTCPeerConnection({
        iceServers: [{
            urls: [ iceServerUrl ],
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
                document.getElementById('chatHistoryHeader').style.visibility = 'visible';
                document.getElementById('chatHistoryContent').style.visibility = 'visible';
                document.getElementById('cartDisplay').hidden = false
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
        let systemPrompt = "You are a MacDonald manager to take orders from customers. You can do 2 functions. Take orders from customers and cancel orders for customers. If the customer wants to take orders, you can only take orders for [big mac, cheeseburger, milo and coca-cola]. If the customer wants to remove items, you can also remove items from the cart that the user has oredered or remove specific items from the cart if the user tells you to do so. E.g The customer says I would like 1 Cheeseburger removed or remove cheeseburger. Tell him that 1 cheeseburger has been removed from the cart, depending on the quantity in numbers. After the customer has said something, just ask him if he would like anything else, no need to repeat the menu again. Example: Customer: I would like 1 big mac. Response: 1 big mac, anything else? If what the customer says is not part of the items that you are trained on, tell them that You could not pick up their owner and tell them to please repeat their order unless they are telling to clear their cart or remove an item for their cart. You do not have to give them  the items that you take orders for. If the customer says he has nothing else to order, say 'Please proceed with checkout'. If the user says Clear Cart or anything along the lines or clearing cart, repeat back 'Cart has been cleared' Nothing else is to be included in the message";
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
}

// Function to add items to cart
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
    const cartItems = document.getElementById('cartItems');
    cartItems.innerHTML = ''; 
    finalCart = [];
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
}

function speakNext(text, endingSilenceMs = 0) {
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

                // Check for empty cart command
                if (lowerText.includes("cart has been cleared") || lowerText.includes("cart emptied")) {
                    emptyCart();
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
                } else {
                    if (lowerText.includes('cheeseburger')) {
                        addToCart('Cheeseburger', 5.99, lowerText);
                    }

                    if (lowerText.includes('big mac')) {
                        addToCart('Big Mac', 6.99, lowerText);
                    }

                    if (lowerText.includes('coca-cola')) {
                        addToCart('Coca-cola', 1.99, lowerText);
                    }

                    if (lowerText.includes('milo')) {
                        addToCart('Milo', 2.49, lowerText);
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

function removeFromCart(product, quantity) {
    // Find the item in the cart
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


// Function to add a message
function addMessage(speaker, text, imgUrlPath = '') {
    let chatHistoryTextArea = document.getElementById('chatHistoryContent'); 
    let messageDiv = document.createElement('div');
    messageDiv.className = `message ${speaker}`;
    
    let bubbleDiv = document.createElement('div');
    bubbleDiv.className = 'bubble';
    
    bubbleDiv.innerHTML = imgUrlPath.trim() ? imgUrlPath.trim() + text : text;
    
    messageDiv.appendChild(bubbleDiv);
    chatHistoryTextArea.appendChild(messageDiv);
    
    chatHistoryTextArea.scrollTop = chatHistoryTextArea.scrollHeight;
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
				if (displaySentence.trim() != ''){
					addMessage('bot',  displaySentence, '')
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

window.onload = () => {
    setInterval(() => {
        checkHung()
        checkLastSpeak()
    }, 2000) // Check session activity every 2 seconds
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
    document.getElementById('chatHistoryContent').innerHTML = ''
    initMessages()
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

            handleUserQuery(userQuery,"","")
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
                if(userQueryHTML.startsWith('<img')){
                    userQueryHTML="<br/>"+userQueryHTML
                }
                if (userQuery !== '') {
                    handleUserQuery(userQuery.trim(''), userQueryHTML, imgUrl)
                    document.getElementById('userMessageBox').innerHTML = ''
                    imgUrl = ""
                }
            }
        })
        document.getElementById('uploadImgIcon').addEventListener('click', function() {
            imgUrl = "https://samples-files.com/samples/Images/jpg/1920-1080-sample.jpg"
            const userMessage = document.getElementById("userMessageBox");
            const childImg = userMessage.querySelector("#picInput");
            if (childImg) {
                userMessage.removeChild(childImg)
            }
            userMessage.innerHTML+='<br/><img id="picInput" src="https://samples-files.com/samples/Images/jpg/1920-1080-sample.jpg" style="width:100px;height:100px"/><br/><br/>'   
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

// Existing code...  
  
// Function to update the cart display  
function updateCartDisplay() {  
    var cartItemsElement = document.getElementById('cartItems');  
    cartItemsElement.innerHTML = ''; // Clear previous items  
    finalCart.forEach(function(item, index) {  
        var li = document.createElement('li');  
        li.className = 'cart-item';  
          
        var img = document.createElement('img');  
        img.src = getImageUrl(item.name); // Function to get image URL based on item name  
          
        var itemName = document.createElement('span');  
        itemName.textContent = `${item.name} - $${(item.price * item.quantity).toFixed(2)}`;  
        itemName.style.padding = '10px'; // Add padding of 10px
        itemName.style.fontSize = '15px';
          
        var quantityInput = document.createElement('input');  
        quantityInput.type = 'number';  
        quantityInput.value = item.quantity;  
        quantityInput.min = 1;  
        quantityInput.max = 999;  
        quantityInput.onchange = function() {  
            updateItemQuantity(index, quantityInput.value);  
        };  
          
        var removeButton = document.createElement('button');  

        removeButton.className = 'removeButton';
        removeButton.textContent = 'X';  
        removeButton.onclick = function() {  
            removeItemFromCart(index);  
        };  
          
        li.appendChild(img);  
        li.appendChild(itemName);  
        li.appendChild(quantityInput);  
        li.appendChild(removeButton);  
        cartItemsElement.appendChild(li);  
    });  
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
        default:  
            return './image/default.png';  
    }  
}  
  
// Function to update item quantity in the cart  
function updateItemQuantity(index, quantity) {  
    finalCart[index].quantity = parseInt(quantity);  
    updateCartDisplay();  
}  
  
// Function to remove item from the cart  
function removeItemFromCart(index) {  
    finalCart.splice(index, 1);  
    updateCartDisplay();  
}  
  
// Function to handle checkout  
function checkout() {  
    // Implement checkout functionality here  
    alert('Proceeding to checkout with items: ' + JSON.stringify(finalCart));  
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
        element.addEventListener(pfx[p]+type, callback, false);
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

    document.getElementById('chatHistory').removeAttribute('hidden');
    document.getElementById('chatHistoryHeader').removeAttribute('hidden');
    document.getElementById('chatHistoryContent').removeAttribute('hidden');
}
 