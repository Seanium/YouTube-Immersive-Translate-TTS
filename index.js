// ==UserScript==
// @name         YouTube字幕文本转语音TTS（适用于沉浸式翻译）
// @namespace    http://tampermonkey.net/
// @version      1.9
// @description  将YouTube上的沉浸式翻译中文字幕转换为语音播放，支持更改音色和调整语音速度
// @author       Sean2333
// @match        https://www.youtube.com/*
// @grant        none
// @license MIT
// @downloadURL https://update.greasyfork.org/scripts/519266/YouTube%E5%AD%97%E5%B9%95%E6%96%87%E6%9C%AC%E8%BD%AC%E8%AF%AD%E9%9F%B3TTS%EF%BC%88%E9%80%82%E7%94%A8%E4%BA%8E%E6%B2%89%E6%B5%B8%E5%BC%8F%E7%BF%BB%E8%AF%91%EF%BC%89.user.js
// @updateURL https://update.greasyfork.org/scripts/519266/YouTube%E5%AD%97%E5%B9%95%E6%96%87%E6%9C%AC%E8%BD%AC%E8%AF%AD%E9%9F%B3TTS%EF%BC%88%E9%80%82%E7%94%A8%E4%BA%8E%E6%B2%89%E6%B5%B8%E5%BC%8F%E7%BF%BB%E8%AF%91%EF%BC%89.meta.js
// ==/UserScript==

(function() {
    'use strict';

    let lastCaptionText = '';
    const synth = window.speechSynthesis;
    let selectedVoice = null;
    let pendingText = null; // 存储等待朗读的文本
    let isWaitingToSpeak = false; // 是否正在等待朗读
    let voiceSelectUI = null;
    let isDragging = false;
    let startX;
    let startY;
    let followVideoSpeed = true; // 是否跟随视频倍速
    let customSpeed = 1.0; // 自定义倍速值
    let isSpeechEnabled = true; // 控制语音播放的开关状态

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

                // 添加超时重试机制
                setTimeout(() => {
                    if (voices.length === 0) {
                        voices = synth.getVoices();
                        if (voices.length > 0) {
                            console.log('通过重试加载到语音列表，共', voices.length, '个语音');
                            resolve(voices);
                        }
                    }
                }, 1000);
            }
        });
    }

    function createVoiceSelectUI() {
        const container = document.createElement('div');
        container.className = 'voice-select-container';
        Object.assign(container.style, {
            position: 'fixed',
            top: '10px',
            right: '10px',
            background: 'rgba(255, 255, 255, 0.9)',
            padding: '10px',
            border: '1px solid rgba(221, 221, 221, 0.8)',
            borderRadius: '5px',
            zIndex: '9999',
            boxShadow: '0 2px 5px rgba(0, 0, 0, 0.15)',
            userSelect: 'none',
            transition: 'all 0.2s'
        });

        // 添加鼠标悬停效果
        container.addEventListener('mouseenter', () => {
            container.style.background = 'rgba(255, 255, 255, 0.95)';
            container.style.boxShadow = '0 2px 8px rgba(0, 0, 0, 0.2)';
        });

        container.addEventListener('mouseleave', () => {
            container.style.background = 'rgba(255, 255, 255, 0.9)';
            container.style.boxShadow = '0 2px 5px rgba(0, 0, 0, 0.15)';
        });

        // 标题栏
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
        toggleButton.textContent = '−';
        Object.assign(toggleButton.style, {
            border: 'none',
            background: 'none',
            cursor: 'pointer',
            fontSize: '16px',
            padding: '0 5px'
        });

        // 内容区域
        const content = document.createElement('div');

        // 创建语音开关控制区域
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

        // 语音开关事件处理
        speechToggleCheckbox.onchange = function() {
            isSpeechEnabled = this.checked;
            // 更新其他控件的状态
            select.disabled = !isSpeechEnabled;
            testButton.disabled = !isSpeechEnabled;
            followSpeedCheckbox.disabled = !isSpeechEnabled;
            customSpeedSelect.disabled = !isSpeechEnabled || followVideoSpeed;

            if (!isSpeechEnabled) {
                // 如果关闭语音，取消当前播放并恢复视频播放
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
            }

            console.log('语音播放已' + (isSpeechEnabled ? '启用' : '禁用'));
        };

        // 组装语音开关UI
        speechToggleDiv.appendChild(speechToggleCheckbox);
        speechToggleDiv.appendChild(speechToggleLabel);

        // 将语音开关添加到内容区域最上方
        content.insertBefore(speechToggleDiv, content.firstChild);

        // 音色选择区域
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

        // 倍速控制区域
        const speedControl = document.createElement('div');
        Object.assign(speedControl.style, {
            marginTop: '10px',
            borderTop: '1px solid #eee',
            paddingTop: '10px'
        });

        // 跟随视频倍速选项
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

        // 自定义倍速选项
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

        // 事件处理
        followSpeedCheckbox.onchange = function() {
            followVideoSpeed = this.checked;
            customSpeedSelect.disabled = this.checked;
            console.log('语音速度模式：', followVideoSpeed ? '跟随视频' : '自定义');
        };

        customSpeedSelect.onchange = function() {
            customSpeed = parseFloat(this.value);
            console.log('自定义语音速度设置为：', customSpeed);
        };

        testButton.onclick = (e) => {
            e.stopPropagation();
            if (selectedVoice) {
                speakText('这是一个测试语音', false);
            }
        };

        // 初始化状态
        customSpeedSelect.disabled = followVideoSpeed;

        // 组装UI
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
        content.appendChild(speedControl);

        container.appendChild(titleBar);
        container.appendChild(content);

        document.body.appendChild(container);

        // 折叠/展开功能
        let isCollapsed = false;
        toggleButton.onclick = (e) => {
            e.stopPropagation();
            isCollapsed = !isCollapsed;

            // 保存当前位置的 right 值
            const currentRight = container.style.right;

            if (isCollapsed) {
                // 保存内容区域的宽度，用于展开时恢复
                container.dataset.expandedWidth = container.offsetWidth + 'px';
                content.style.display = 'none';
                // 调整容器宽度为标题栏所需的最小宽度
                container.style.width = 'auto';
                container.style.minWidth = '100px';
            } else {
                content.style.display = 'block';
                // 恢复原来的宽度
                container.style.width = container.dataset.expandedWidth;
            }

            // 保持 right 值不变
            container.style.right = currentRight;
            toggleButton.textContent = isCollapsed ? '+' : '−';
        };

        // 添加拖动事件监听
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
        isDragging = false;
        const container = document.querySelector('.voice-select-container');
        if (container) {
            container.style.transition = 'all 0.2s';
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

                // 转换为 right 值
                container.style.right = `${window.innerWidth - newX - container.offsetWidth}px`;
                container.style.top = `${newY}px`;
                // 清除 left 属性
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

            selectedVoice = chineseVoices.find(voice =>
                voice.name === 'Microsoft Xiaoxiao Online (Natural) - Chinese (Mainland)'
            ) || chineseVoices[0];

            const selectedIndex = chineseVoices.indexOf(selectedVoice);
            if (selectedIndex >= 0) {
                select.selectedIndex = selectedIndex;
            }

            select.onchange = function() {
                selectedVoice = chineseVoices[this.value];
                console.log('已切换语音到：', selectedVoice.name);
            };

            console.log('可用的中文语音数量：', chineseVoices.length);
            if (chineseVoices.length > 0) {
                console.log('第一个可用的中文语音：', chineseVoices[0].name);
            }
        });
    }

    function speakText(text, isNewCaption = false) {
        // 如果语音播放被禁用，直接返回
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

        // console.log('准备朗读文本：', text);
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

            // 设置语速
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
            // 直接查找所有 target-cue 类的元素
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
        function waitForCaptionContainer() {
            const immersiveCaptionWindow = document.querySelector('#immersive-translate-caption-window');
            if (immersiveCaptionWindow && immersiveCaptionWindow.shadowRoot) {
                // 改为监听 shadowRoot 下的第一层 div
                const rootContainer = immersiveCaptionWindow.shadowRoot.querySelector('div');
                if (rootContainer) {
                    console.log('找到字幕根容器，开始监听变化');

                    const observer = new MutationObserver(() => {
                        // 获取当前文本
                        const currentText = getCaptionText();
                        if (currentText && currentText !== lastCaptionText) {
                            lastCaptionText = currentText;
                            speakText(currentText, true);
                        }
                    });

                    const config = {
                        childList: true,
                        subtree: true,
                        characterData: true  // 添加对文本内容变化的监听
                    };

                    observer.observe(rootContainer, config);

                    const initialText = getCaptionText();
                    if (initialText) {
                        lastCaptionText = initialText;
                        speakText(initialText, true);
                    }
                } else {
                    setTimeout(waitForCaptionContainer, 1000);
                }
            } else {
                setTimeout(waitForCaptionContainer, 1000);
            }
        }

        waitForCaptionContainer();
    }

    function cleanup() {
        document.removeEventListener('mousedown', dragStart);
        document.removeEventListener('mousemove', drag);
        document.removeEventListener('mouseup', dragEnd);
        document.removeEventListener('mouseleave', dragEnd);
    }

    window.addEventListener('load', function() {
        console.log('页面加载完成，开始初始化脚本');
        setTimeout(() => {
            selectVoice();
            setupCaptionObserver();
        }, 1000);
    });

    window.addEventListener('unload', cleanup);

    // 修改窗口大小变化处理
    window.addEventListener('resize', function() {
        const container = document.querySelector('.voice-select-container');
        if (container) {
            const rect = container.getBoundingClientRect();
            const maxY = window.innerHeight - container.offsetHeight;

            // 保持右侧距离不变，只调整 top 值
            let newY = Math.min(Math.max(0, rect.top), maxY);
            container.style.top = `${newY}px`;
        }
    });

})();