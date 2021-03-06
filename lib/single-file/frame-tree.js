/*
 * Copyright 2018 Gildas Lormeau
 * contact : gildas.lormeau <at> gmail.com
 * 
 * This file is part of SingleFile.
 *
 *   SingleFile is free software: you can redistribute it and/or modify
 *   it under the terms of the GNU Lesser General Public License as published by
 *   the Free Software Foundation, either version 3 of the License, or
 *   (at your option) any later version.
 *
 *   SingleFile is distributed in the hope that it will be useful,
 *   but WITHOUT ANY WARRANTY; without even the implied warranty of
 *   MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 *   GNU Lesser General Public License for more details.
 *
 *   You should have received a copy of the GNU Lesser General Public License
 *   along with SingleFile.  If not, see <http://www.gnu.org/licenses/>.
 */

/* global window, top, document, addEventListener, docHelper, timeout */

this.frameTree = this.frameTree || (() => {

	const MESSAGE_PREFIX = "__frameTree__";
	const FRAMES_CSS_SELECTOR = "iframe, frame, object[type=\"text/html\"][data]";
	const INIT_REQUEST_MESSAGE = "initRequest";
	const INIT_RESPONSE_MESSAGE = "initResponse";
	const TIMEOUT_INIT_REQUEST_MESSAGE = 500;
	const TOP_WINDOW = isTopWindow(window);

	let sessions = new Map(), windowId;

	if (TOP_WINDOW) {
		windowId = "0";
	}
	addEventListener("message", event => {
		if (typeof event.data == "string" && event.data.startsWith(MESSAGE_PREFIX + "::")) {
			const message = JSON.parse(event.data.substring(MESSAGE_PREFIX.length + 2));
			if (message.method == INIT_REQUEST_MESSAGE) {
				initRequest(message);
			} else if (message.method == INIT_RESPONSE_MESSAGE) {
				initResponse(message);
			}
		}
	}, false);
	return {
		getAsync: async options => {
			const sessionId = options.sessionId;
			options = JSON.parse(JSON.stringify(options));
			return new Promise(resolve => {
				sessions.set(sessionId, { frames: [], resolve });
				initRequest({ windowId, sessionId, options });
			});
		},
		getSync: options => {
			const sessionId = options.sessionId;
			options = JSON.parse(JSON.stringify(options));
			sessions.set(sessionId, { frames: [] });
			initRequest({ windowId, sessionId, options });
			return sessions.get(sessionId);
		},
		initResponse
	};

	function initRequest(message) {
		const sessionId = message.sessionId;
		const frameElements = document.querySelectorAll(FRAMES_CSS_SELECTOR);
		if (!TOP_WINDOW) {
			windowId = message.windowId;
			const docData = docHelper.preProcessDoc(document, window, message.options);
			const content = docHelper.serialize(document);
			docHelper.postProcessDoc(document, window, message.options);
			callTopInitResponse({
				method: INIT_RESPONSE_MESSAGE, framesData: [{
					windowId,
					content,
					baseURI: document.baseURI.split("#")[0],
					title: document.title,
					emptyStyleRulesText: docData.emptyStyleRulesText,
					canvasData: docData.canvasData,
					processed: true,
				}], sessionId
			});
		}
		processFrames(frameElements, message.options, windowId, sessionId);
	}

	function initResponse(message) {
		const windowData = sessions.get(message.sessionId);
		if (windowData) {
			message.framesData.forEach(messageFrameData => {
				let frameData = windowData.frames.find(frameData => messageFrameData.windowId == frameData.windowId);
				if (!frameData) {
					frameData = { windowId: messageFrameData.windowId };
					windowData.frames.push(frameData);
				}
				frameData.content = messageFrameData.content;
				frameData.baseURI = messageFrameData.baseURI;
				frameData.title = messageFrameData.title;
				frameData.emptyStyleRulesText = messageFrameData.emptyStyleRulesText;
				frameData.canvasData = messageFrameData.canvasData;
				frameData.processed = messageFrameData.processed;
				frameData.timeout = messageFrameData.timeout;
			});
			const remainingFrames = windowData.frames.filter(frameData => !frameData.processed).length;
			if (!remainingFrames) {
				sessions.delete(message.sessionId);
				windowData.resolve(windowData.frames.sort((frame1, frame2) => frame2.windowId.split(".").length - frame1.windowId.split(".").length));
			}
		}
	}

	function processFrames(frameElements, options, windowId, sessionId) {
		let framesData = [];
		frameElements.forEach((frameElement, frameIndex) => {
			const frameWindowId = windowId + "." + frameIndex;
			frameElement.setAttribute(docHelper.windowIdAttributeName(options.sessionId), frameWindowId);
			framesData.push({ windowId: frameWindowId });
			if (!frameElement.contentDocument) {
				try {
					frameElement.contentWindow.postMessage(MESSAGE_PREFIX + "::" + JSON.stringify({ method: INIT_REQUEST_MESSAGE, windowId: frameWindowId, sessionId, options }), "*");
				} catch (error) {
					/* ignored */
				}
			}
			timeout.set(() => top.postMessage(MESSAGE_PREFIX + "::" + JSON.stringify({
				method: INIT_RESPONSE_MESSAGE,
				framesData: [{ windowId: frameWindowId, processed: true, timeout: true }],
				windowId: frameWindowId, sessionId
			}), "*"), TIMEOUT_INIT_REQUEST_MESSAGE);
		});
		callTopInitResponse({ method: INIT_RESPONSE_MESSAGE, framesData, windowId, sessionId });
		if (frameElements.length) {
			framesData = [];
			frameElements.forEach((frameElement, frameIndex) => {
				const frameWindowId = windowId + "." + frameIndex;
				const frameWindow = frameElement.contentWindow;
				const frameDoc = frameElement.contentDocument;
				if (frameDoc) {
					try {
						processFrames(frameDoc.querySelectorAll(FRAMES_CSS_SELECTOR), options, frameWindowId, sessionId);
						const docData = docHelper.preProcessDoc(frameDoc, frameWindow, options);
						framesData.push({
							windowId: frameWindowId,
							content: docHelper.serialize(frameDoc),
							baseURI: frameDoc.baseURI.split("#")[0],
							title: frameDoc.title,
							emptyStyleRulesText: docData.emptyStyleRulesText,
							canvasData: docData.canvasData,
							processed: true
						});
						docHelper.postProcessDoc(frameDoc, frameWindow, options);
					} catch (error) {
						framesData.push({
							windowId: frameWindowId,
							processed: true
						});
					}
				}
			});
			callTopInitResponse({ method: INIT_RESPONSE_MESSAGE, framesData, windowId, sessionId });
		}
	}

	function callTopInitResponse(message) {
		try {
			top.frameTree.initResponse(message);
		} catch (error) {
			top.postMessage(MESSAGE_PREFIX + "::" + JSON.stringify(message), "*");
		}
	}

	function isTopWindow(win) {
		return win == top;
	}

})();