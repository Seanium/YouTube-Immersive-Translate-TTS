// ==UserScript==
// @name         YouTube字幕文本转语音TTS（适用于沉浸式翻译）
// @namespace    http://tampermonkey.net/
// @version      1.10
// @description  将YouTube上的沉浸式翻译中文字幕转换为语音播放，支持更改音色和调整语音速度
// @author       Sean2333
// @match        https://www.youtube.com/*
// @grant        GM_setValue
// @grant        GM_getValue
// @license      MIT
// ==/UserScript==

(function() {
    'use strict';

    let lastCaptionText = '';
    const synth = window.speechSynthesis;
    let selectedVoice = null;
    let pendingText = null;
    let isWaitingToSpeak = false;
    let voiceSelectUI = null;
    let isDragging = false;
    let startX;
    let startY;
    let followVideoSpeed = GM_getValue('followVideoSpeed', true);
    let customSpeed = GM_getValue('customSpeed', 1.0);
    let isSpeechEnabled = GM_getValue('isSpeechEnabled', true);
    let speechVolume = GM_getValue('speechVolume', 1.0);
    let isCollapsed = GM_getValue('isCollapsed', false);
    let selectedVoiceName = GM_getValue('selectedVoiceName', null);
    let windowPosX = GM_getValue('windowPosX', null);
    let windowPosY = GM_getValue('windowPosY', null);
    let currentObserver = null;
    let currentVideoId = null;
    let videoObserver = null;
    let originalPushState = null;
    let originalReplaceState = null;
    let timeoutIds = [];

    function loadVoices() {
        return new Promise(function(resolve) {
            let voices = synth.getVoices();
            if (voices.length !== 0) {
                console.log('成功加载语音列表，共', voices.length, '个语音');
                resolve(voices);
            } else {
                console.log('等待语音列表加载...');
                synth.onvoiceschanged = function() {
                    voices = synth.getVoices();
                    console.log('语音列表加载完成，共', voices.length, '个语音');
                    resolve(voices);
                };

                const timeoutId = setTimeout(() => {
                    voices = synth.getVoices();
                    if (voices.length > 0) {
                        console.log('通过重试加载到语音列表，共', voices.length, '个语音');
                        resolve(voices);
                    }
                }, 1000);
                timeoutIds.push(timeoutId);
            }
        });
    }

    function createVoiceSelectUI() {
        const container = document.createElement('div');
        container.className = 'voice-select-container';
        Object.assign(container.style, {
            position: 'fixed',
            top: windowPosY || '10px',
            right: windowPosX || '10px',
            background: 'rgba(255, 255, 255, 0.9)',
            padding: '10px',
            border: '1px solid rgba(221, 221, 221, 0.8)',
            borderRadius: '5px',
            zIndex: '9999',
            boxShadow: '0 2px 5px rgba(0, 0, 0, 0.15)',
            userSelect: 'none',
            transition: 'all 0.2s'
        });

        container.addEventListener('mouseenter', () => {
            container.style.background = 'rgba(255, 255, 255, 0.95)';
            container.style.boxShadow = '0 2px 8px rgba(0, 0, 0, 0.2)';
        });

        container.addEventListener('mouseleave', () => {
            container.style.background = 'rgba(255, 255, 255, 0.9)';
            container.style.boxShadow = '0 2px 5px rgba(0, 0, 0, 0.15)';
        });

        const titleBar = document.createElement('div');
        titleBar.className = 'title-bar';
        Object.assign(titleBar.style, {
            padding: '5px',
            marginBottom: '10px',
            borderBottom: '1px solid #eee',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            cursor: 'move'
        });

        const title = document.createElement('span');
        title.textContent = '语音设置';

        const toggleButton = document.createElement('button');
        toggleButton.textContent = isCollapsed ? '+' : '−';
        Object.assign(toggleButton.style, {
            border: 'none',
            background: 'none',
            cursor: 'pointer',
            fontSize: '16px',
            padding: '0 5px'
        });

        const content = document.createElement('div');
        if (isCollapsed) {
            content.style.display = 'none';
        }

        const speechToggleDiv = document.createElement('div');
        Object.assign(speechToggleDiv.style, {
            marginBottom: '10px',
            borderBottom: '1px solid #eee',
            paddingBottom: '10px'
        });

        const speechToggleCheckbox = document.createElement('input');
        speechToggleCheckbox.type = 'checkbox';
        speechToggleCheckbox.checked = isSpeechEnabled;
        speechToggleCheckbox.id = 'speechToggleCheckbox';

        const speechToggleLabel = document.createElement('label');
        speechToggleLabel.textContent = '启用语音播放';
        speechToggleLabel.htmlFor = 'speechToggleCheckbox';
        Object.assign(speechToggleLabel.style, {
            marginLeft: '5px'
        });

        speechToggleCheckbox.onchange = function() {
            isSpeechEnabled = this.checked;
            select.disabled = !isSpeechEnabled;
            testButton.disabled = !isSpeechEnabled;
            followSpeedCheckbox.disabled = !isSpeechEnabled;
            customSpeedSelect.disabled = !isSpeechEnabled || followVideoSpeed;
            volumeSlider.disabled = !isSpeechEnabled;

            GM_setValue('isSpeechEnabled', isSpeechEnabled);

            if (!isSpeechEnabled) {
                if (synth.speaking) {
                    synth.cancel();
                }
                if (isWaitingToSpeak) {
                    const video = document.querySelector('video');
                    if (video && video.paused) {
                        video.play();
                    }
                    isWaitingToSpeak = false;
                }
                pendingText = null;

                disconnectObservers();
            } else {
                setupCaptionObserver();
                setupNavigationListeners();
            }

            console.log('语音播放已' + (isSpeechEnabled ? '启用' : '禁用'));
        };

        speechToggleDiv.appendChild(speechToggleCheckbox);
        speechToggleDiv.appendChild(speechToggleLabel);
        content.insertBefore(speechToggleDiv, content.firstChild);

        const voiceDiv = document.createElement('div');
        Object.assign(voiceDiv.style, {
            marginBottom: '10px'
        });

        const voiceLabel = document.createElement('div');
        voiceLabel.textContent = '选择音色：';
        Object.assign(voiceLabel.style, {
            marginBottom: '5px'
        });

        const select = document.createElement('select');
        Object.assign(select.style, {
            width: '100%',
            padding: '5px',
            marginBottom: '5px',
            borderRadius: '3px'
        });

        const testButton = document.createElement('button');
        testButton.textContent = '测试音色';
        Object.assign(testButton.style, {
            padding: '5px 10px',
            borderRadius: '3px',
            cursor: 'pointer',
            width: '100%'
        });

        const volumeControl = document.createElement('div');
        Object.assign(volumeControl.style, {
            marginTop: '10px',
            borderTop: '1px solid #eee',
            paddingTop: '10px'
        });

        const volumeLabel = document.createElement('div');
        volumeLabel.textContent = '音量控制：';
        Object.assign(volumeLabel.style, {
            marginBottom: '5px'
        });

        const volumeSlider = document.createElement('input');
        volumeSlider.type = 'range';
        volumeSlider.min = '0';
        volumeSlider.max = '1';
        volumeSlider.step = '0.1';
        volumeSlider.value = speechVolume;
        Object.assign(volumeSlider.style, {
            width: '100%',
            margin: '5px 0',
        });

        const volumeValue = document.createElement('span');
        volumeValue.textContent = `${Math.round(speechVolume * 100)}%`;
        Object.assign(volumeValue.style, {
            fontSize: '12px',
            color: '#666',
            marginLeft: '5px'
        });

        volumeSlider.onchange = function() {
            speechVolume = parseFloat(this.value);
            volumeValue.textContent = `${Math.round(speechVolume * 100)}%`;
            GM_setValue('speechVolume', speechVolume);
            console.log('音量已设置为：', speechVolume);
        };

        volumeSlider.oninput = function() {
            volumeValue.textContent = `${Math.round(this.value * 100)}%`;
        };

        volumeControl.appendChild(volumeLabel);
        volumeControl.appendChild(volumeSlider);
        volumeControl.appendChild(volumeValue);

        const speedControl = document.createElement('div');
        Object.assign(speedControl.style, {
            marginTop: '10px',
            borderTop: '1px solid #eee',
            paddingTop: '10px'
        });

        const followSpeedDiv = document.createElement('div');
        Object.assign(followSpeedDiv.style, {
            marginBottom: '8px'
        });

        const followSpeedCheckbox = document.createElement('input');
        followSpeedCheckbox.type = 'checkbox';
        followSpeedCheckbox.checked = followVideoSpeed;
        followSpeedCheckbox.id = 'followSpeedCheckbox';

        const followSpeedLabel = document.createElement('label');
        followSpeedLabel.textContent = '跟随视频倍速';
        followSpeedLabel.htmlFor = 'followSpeedCheckbox';
        Object.assign(followSpeedLabel.style, {
            marginLeft: '5px'
        });

        const customSpeedDiv = document.createElement('div');

        const customSpeedLabel = document.createElement('div');
        customSpeedLabel.textContent = '自定义倍速：';
        Object.assign(customSpeedLabel.style, {
            marginBottom: '5px'
        });

        const customSpeedSelect = document.createElement('select');
        const speedOptions = [0.5, 0.75, 1.0, 1.25, 1.5, 1.75, 2.0];
        speedOptions.forEach(speed => {
            const option = document.createElement('option');
            option.value = speed;
            option.textContent = `${speed}x`;
            if (speed === customSpeed) option.selected = true;
            customSpeedSelect.appendChild(option);
        });

        Object.assign(customSpeedSelect.style, {
            width: '100%',
            padding: '5px',
            borderRadius: '3px'
        });

        followSpeedCheckbox.onchange = function() {
            followVideoSpeed = this.checked;
            customSpeedSelect.disabled = this.checked;
            GM_setValue('followVideoSpeed', followVideoSpeed);
            console.log('语音速度模式：', followVideoSpeed ? '跟随视频' : '自定义');
        };

        customSpeedSelect.onchange = function() {
            customSpeed = parseFloat(this.value);
            GM_setValue('customSpeed', customSpeed);
            console.log('自定义语音速度设置为：', customSpeed);
        };

        testButton.onclick = (e) => {
            e.stopPropagation();
            if (selectedVoice) {
                speakText('这是一个测试语音', false);
            }
        };

        customSpeedSelect.disabled = followVideoSpeed;

        titleBar.appendChild(title);
        titleBar.appendChild(toggleButton);

        voiceDiv.appendChild(voiceLabel);
        voiceDiv.appendChild(select);
        voiceDiv.appendChild(testButton);

        followSpeedDiv.appendChild(followSpeedCheckbox);
        followSpeedDiv.appendChild(followSpeedLabel);

        customSpeedDiv.appendChild(customSpeedLabel);
        customSpeedDiv.appendChild(customSpeedSelect);

        speedControl.appendChild(followSpeedDiv);
        speedControl.appendChild(customSpeedDiv);

        content.appendChild(voiceDiv);
        content.appendChild(volumeControl);
        content.appendChild(speedControl);

        container.appendChild(titleBar);
        container.appendChild(content);

        if (isCollapsed) {
            container.style.width = 'auto';
            container.style.minWidth = '100px';
        }

        document.body.appendChild(container);

        toggleButton.onclick = (e) => {
            e.stopPropagation();
            isCollapsed = !isCollapsed;

            const currentRight = container.style.right;

            if (isCollapsed) {
                container.dataset.expandedWidth = container.offsetWidth + 'px';
                content.style.display = 'none';
                container.style.width = 'auto';
                container.style.minWidth = '100px';
            } else {
                content.style.display = 'block';
                container.style.width = container.dataset.expandedWidth;
            }

            container.style.right = currentRight;
            toggleButton.textContent = isCollapsed ? '+' : '−';

            GM_setValue('isCollapsed', isCollapsed);
        };

        document.addEventListener('mousedown', dragStart);
        document.addEventListener('mousemove', drag);
        document.addEventListener('mouseup', dragEnd);
        document.addEventListener('mouseleave', dragEnd);

        return { container, select, content };
    }

    function dragStart(e) {
        if (e.target.closest('.title-bar')) {
            isDragging = true;
            const container = e.target.closest('.voice-select-container');

            const rect = container.getBoundingClientRect();
            startX = e.clientX - rect.left;
            startY = e.clientY - rect.top;

            container.style.transition = 'none';
        }
    }

    function dragEnd(e) {
        if (isDragging) {
            isDragging = false;
            const container = document.querySelector('.voice-select-container');
            if (container) {
                container.style.transition = 'all 0.2s';

                const rect = container.getBoundingClientRect();
                windowPosX = `${window.innerWidth - rect.right}px`;
                windowPosY = `${rect.top}px`;
                GM_setValue('windowPosX', windowPosX);
                GM_setValue('windowPosY', windowPosY);
                console.log('保存浮窗位置：', windowPosX, windowPosY);
            }
        }
    }

    function drag(e) {
        if (isDragging) {
            e.preventDefault();
            const container = document.querySelector('.voice-select-container');
            if (container) {
                let newX = e.clientX - startX;
                let newY = e.clientY - startY;

                const maxX = window.innerWidth - container.offsetWidth;
                const maxY = window.innerHeight - container.offsetHeight;

                newX = Math.min(Math.max(0, newX), maxX);
                newY = Math.min(Math.max(0, newY), maxY);

                container.style.right = `${window.innerWidth - newX - container.offsetWidth}px`;
                container.style.top = `${newY}px`;
                container.style.left = '';
            }
        }
    }

    function selectVoice() {
        loadVoices().then(function(voices) {
            if (!voiceSelectUI) {
                voiceSelectUI = createVoiceSelectUI();
            }

            const select = voiceSelectUI.select;
            while (select.firstChild) {
                select.removeChild(select.firstChild);
            }

            const chineseVoices = voices.filter(voice =>
                                                voice.lang.includes('zh') || voice.name.toLowerCase().includes('chinese')
                                               );

            chineseVoices.forEach((voice, index) => {
                const option = document.createElement('option');
                option.value = index;
                option.textContent = `${voice.name} (${voice.lang})`;
                select.appendChild(option);
            });

            if (selectedVoiceName) {
                selectedVoice = chineseVoices.find(voice => voice.name === selectedVoiceName);
            }

            if (!selectedVoice) {
                selectedVoice = chineseVoices.find(voice =>
                                                   voice.name === 'Microsoft Xiaoxiao Online (Natural) - Chinese (Mainland)'
                                                  ) || chineseVoices[0];
            }

            const selectedIndex = chineseVoices.indexOf(selectedVoice);
            if (selectedIndex >= 0) {
                select.selectedIndex = selectedIndex;
            }

            select.onchange = function() {
                selectedVoice = chineseVoices[this.value];
                selectedVoiceName = selectedVoice.name;
                GM_setValue('selectedVoiceName', selectedVoiceName);
                console.log('已切换语音到：', selectedVoice.name);
            };

            console.log('可用的中文语音数量：', chineseVoices.length);
            if (chineseVoices.length > 0) {
                console.log('第一个可用的中文语音：', chineseVoices[0].name);
            }
        });
    }

    function speakText(text, isNewCaption = false) {
        if (!isSpeechEnabled) {
            return;
        }

        const video = document.querySelector('video');

        if (isNewCaption && synth.speaking) {
            console.log('新字幕出现，但当前语音未完成');
            pendingText = text;
            if (video && !video.paused) {
                video.pause();
                isWaitingToSpeak = true;
                console.log('视频已暂停，等待当前语音完成');
            }
            return;
        }

        if (synth.speaking) {
            console.log('正在停止当前语音播放');
            synth.cancel();
        }

        if (text) {
            const utterance = new SpeechSynthesisUtterance(text);
            utterance.lang = 'zh-CN';

            if (selectedVoice) {
                utterance.voice = selectedVoice;
            }

            utterance.volume = speechVolume;

            if (followVideoSpeed && video) {
                utterance.rate = video.playbackRate;
                console.log('使用视频倍速：', utterance.rate);
            } else {
                utterance.rate = customSpeed;
                console.log('使用自定义倍速：', utterance.rate);
            }

            utterance.onend = () => {
                console.log('当前语音播放完成');

                if (pendingText) {
                    console.log('播放等待的文本');
                    const nextText = pendingText;
                    pendingText = null;
                    speakText(nextText);
                }
                else if (isWaitingToSpeak && video && video.paused) {
                    isWaitingToSpeak = false;
                    video.play();
                    console.log('所有语音播放完成，视频继续播放');
                }
            };

            utterance.onerror = () => {
                console.error('语音播放出错');
                if (isWaitingToSpeak && video && video.paused) {
                    isWaitingToSpeak = false;
                    video.play();
                    console.log('语音播放出错，视频继续播放');
                }
                pendingText = null;
            };

            synth.speak(utterance);
            console.log('开始朗读');
        } else {
            console.log('文本为空，跳过朗读');
        }
    }

    function getCaptionText() {
        const immersiveCaptionWindow = document.querySelector('#immersive-translate-caption-window');
        if (immersiveCaptionWindow && immersiveCaptionWindow.shadowRoot) {
            const targetCaptions = immersiveCaptionWindow.shadowRoot.querySelectorAll('.target-cue');
            let captionText = '';
            targetCaptions.forEach(span => {
                captionText += span.textContent + ' ';
            });
            captionText = captionText.trim();
            return captionText;
        }
        return '';
    }

    function setupCaptionObserver() {
        if (!isSpeechEnabled) {
            return;
        }

        let retryCount = 0;
        const maxRetries = 10;

        function waitForCaptionContainer() {
            if (!isSpeechEnabled) {
                return;
            }

            const immersiveCaptionWindow = document.querySelector('#immersive-translate-caption-window');
            if (immersiveCaptionWindow && immersiveCaptionWindow.shadowRoot) {
                const rootContainer = immersiveCaptionWindow.shadowRoot.querySelector('div');
                if (rootContainer) {
                    console.log('找到字幕根容器，开始监听变化');

                    if (currentObserver) {
                        currentObserver.disconnect();
                        console.log('断开旧的字幕观察者连接');
                    }

                    lastCaptionText = '';
                    pendingText = null;
                    if (synth.speaking) {
                        synth.cancel();
                        console.log('取消当前正在播放的语音');
                    }
                    isWaitingToSpeak = false;

                    currentObserver = new MutationObserver(() => {
                        const currentText = getCaptionText();
                        if (currentText && currentText !== lastCaptionText) {
                            lastCaptionText = currentText;
                            speakText(currentText, true);
                        }
                    });

                    const config = {
                        childList: true,
                        subtree: true,
                        characterData: true
                    };

                    currentObserver.observe(rootContainer, config);
                    console.log('新的字幕观察者设置完成');

                    const initialText = getCaptionText();
                    if (initialText) {
                        lastCaptionText = initialText;
                        speakText(initialText, true);
                    }
                } else {
                    if (retryCount < maxRetries) {
                        console.log('未找到字幕容器，1秒后重试');
                        retryCount++;
                        const timeoutId = setTimeout(waitForCaptionContainer, 1000);
                        timeoutIds.push(timeoutId);
                    } else {
                        console.log('达到最大重试次数，放弃寻找字幕容器');
                    }
                }
            } else {
                if (retryCount < maxRetries) {
                    console.log('等待字幕窗口加载，1秒后重试');
                    retryCount++;
                    const timeoutId = setTimeout(waitForCaptionContainer, 1000);
                    timeoutIds.push(timeoutId);
                } else {
                    console.log('达到最大重试次数，放弃寻找字幕窗口');
                }
            }
        }

        waitForCaptionContainer();
    }

    function checkForVideoChange() {
        if (!isSpeechEnabled) {
            return;
        }

        const videoId = new URLSearchParams(window.location.search).get('v');

        if (videoId && videoId !== currentVideoId) {
            console.log('检测到视频切换，从', currentVideoId, '切换到', videoId);
            currentVideoId = videoId;

            if (currentObserver) {
                currentObserver.disconnect();
                console.log('断开旧的字幕观察者连接');
            }
            if (synth.speaking) {
                synth.cancel();
                console.log('取消当前正在播放的语音');
            }

            let retryCount = 0;
            const maxRetries = 10;

            function trySetupObserver() {
                if (!isSpeechEnabled) {
                    return;
                }

                if (retryCount >= maxRetries) {
                    console.log('达到最大重试次数，放弃设置字幕监听');
                    return;
                }

                const immersiveCaptionWindow = document.querySelector('#immersive-translate-caption-window');
                if (immersiveCaptionWindow && immersiveCaptionWindow.shadowRoot) {
                    console.log('找到字幕容器，开始设置监听');
                    setupCaptionObserver();
                } else {
                    console.log(`未找到字幕容器，${retryCount + 1}秒后重试`);
                    retryCount++;
                    const timeoutId = setTimeout(trySetupObserver, 1000);
                    timeoutIds.push(timeoutId);
                }
            }

            const timeoutId = setTimeout(trySetupObserver, 1500);
            timeoutIds.push(timeoutId);
        }
    }

    function setupNavigationListeners() {
        if (!isSpeechEnabled) {
            return;
        }

        videoObserver = new MutationObserver((mutations) => {
            for (const mutation of mutations) {
                if (mutation.type === 'childList') {
                    checkForVideoChange();
                }
            }
        });

        function observeVideoPlayer() {
            const playerContainer = document.querySelector('#player-container');
            if (playerContainer) {
                videoObserver.observe(playerContainer, {
                    childList: true,
                    subtree: true
                });
            }
        }

        observeVideoPlayer();

        originalPushState = history.pushState;
        history.pushState = function() {
            originalPushState.apply(history, arguments);
            checkForVideoChange();
        };

        originalReplaceState = history.replaceState;
        history.replaceState = function() {
            originalReplaceState.apply(history, arguments);
            checkForVideoChange();
        };

        window.addEventListener('hashchange', checkForVideoChange);
        window.addEventListener('popstate', checkForVideoChange);

        window.addEventListener('yt-navigate-start', onNavigateStart);
        window.addEventListener('yt-navigate-finish', onNavigateFinish);
    }

    function onNavigateStart() {
        if (isSpeechEnabled) {
            console.log('YouTube导航开始');
            checkForVideoChange();
        }
    }

    function onNavigateFinish() {
        if (isSpeechEnabled) {
            console.log('YouTube导航完成');
            checkForVideoChange();
        }
    }

    function disconnectObservers() {
        if (currentObserver) {
            currentObserver.disconnect();
            currentObserver = null;
            console.log('已断开字幕观察者');
        }

        if (videoObserver) {
            videoObserver.disconnect();
            videoObserver = null;
            console.log('已断开视频观察者');
        }

        window.removeEventListener('hashchange', checkForVideoChange);
        window.removeEventListener('popstate', checkForVideoChange);
        window.removeEventListener('yt-navigate-start', onNavigateStart);
        window.removeEventListener('yt-navigate-finish', onNavigateFinish);

        if (originalPushState) {
            history.pushState = originalPushState;
            originalPushState = null;
        }

        if (originalReplaceState) {
            history.replaceState = originalReplaceState;
            originalReplaceState = null;
        }

        timeoutIds.forEach(id => clearTimeout(id));
        timeoutIds = [];
    }

    function cleanup() {
        document.removeEventListener('mousedown', dragStart);
        document.removeEventListener('mousemove', drag);
        document.removeEventListener('mouseup', dragEnd);
        document.removeEventListener('mouseleave', dragEnd);

        window.removeEventListener('resize', onWindowResize);

        disconnectObservers();

        if (synth.speaking) {
            synth.cancel();
        }
    }

    function onWindowResize() {
        const container = document.querySelector('.voice-select-container');
        if (container) {
            const rect = container.getBoundingClientRect();
            const maxY = window.innerHeight - container.offsetHeight;

            let newY = Math.min(Math.max(0, rect.top), maxY);
            container.style.top = `${newY}px`;
        }
    }

    window.addEventListener('load', function() {
        console.log('页面加载完成，开始初始化脚本');
        setTimeout(() => {
            selectVoice();

            if (isSpeechEnabled) {
                setupCaptionObserver();
                setupNavigationListeners();

                currentVideoId = new URLSearchParams(window.location.search).get('v');
                console.log('初始视频ID:', currentVideoId);
            }
        }, 1000);
    });

    window.addEventListener('unload', cleanup);

    window.addEventListener('resize', onWindowResize);

})();