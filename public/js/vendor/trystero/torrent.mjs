import { createRelayManager, createStrategy, entries, fromJson, genId, getRelays, keys, libName, makeSocket, pauseRelayReconnection, resumeRelayReconnection, selfId, sha1, toJson } from "./core/index.mjs";
//#region src/index.ts
const relayManager = createRelayManager((client) => client.socket);
const topicToInfoHash = {};
const infoHashToTopic = {};
const handledSignals = {};
const topicStates = relayManager.scoped();
const roomOutstandingOffers = {};
const roomOfferGenerationPromises = {};
const roomSubscriberCounts = {};
const trackerAction = "announce";
const hashLimit = 20;
const offersPerAnnounce = 1;
const requestedPeers = 3;
const defaultAnnounceMs = 1e4;
const dormantAnnounceMs = 12e4;
const offerRetentionMs = 12e4;
const signalDedupeWindowMs = 4e3;
const defaultRedundancy = 3;
const getInfoHash = async (topic) => {
	if (topicToInfoHash[topic]) return topicToInfoHash[topic];
	const hash = (await sha1(topic)).slice(0, hashLimit);
	topicToInfoHash[topic] = hash;
	infoHashToTopic[hash] = topic;
	return hash;
};
const send = async (client, topic, payload) => client.send(toJson({
	action: trackerAction,
	info_hash: await getInfoHash(topic),
	peer_id: selfId,
	...payload
}));
const warn = (url, msg, didFail = false) => console.warn(`${libName}: torrent tracker ${didFail ? "failure" : "warning"} from ${url} - ${msg}`);
const getRoomOutstandingOffers = (rootTopic) => roomOutstandingOffers[rootTopic] ??= {};
const deleteRoomOfferBookkeeping = (rootTopic) => {
	delete roomOutstandingOffers[rootTopic];
	delete roomOfferGenerationPromises[rootTopic];
};
const takeOutstandingOffer = (rootTopic, offerId, action) => {
	const outstandingOffers = roomOutstandingOffers[rootTopic];
	const offer = outstandingOffers?.[offerId];
	if (!offer) return;
	delete outstandingOffers[offerId];
	offer[action]?.();
	if (!keys(outstandingOffers).length && !roomSubscriberCounts[rootTopic]) deleteRoomOfferBookkeeping(rootTopic);
	return offer;
};
const reclaimAllOutstandingOffers = (rootTopic) => {
	keys(getRoomOutstandingOffers(rootTopic)).forEach((offerId) => takeOutstandingOffer(rootTopic, offerId, "reclaim"));
	deleteRoomOfferBookkeeping(rootTopic);
};
const pruneOutstandingOffers = (rootTopic) => {
	const now = Date.now();
	entries(getRoomOutstandingOffers(rootTopic)).forEach(([offerId, offer]) => {
		if (now - offer.createdAt > offerRetentionMs) takeOutstandingOffer(rootTopic, offerId, "reclaim");
	});
};
const ensureOutstandingOffers = async (rootTopic, getOffers) => {
	while (roomOfferGenerationPromises[rootTopic]) await roomOfferGenerationPromises[rootTopic];
	const nextPromise = (async () => {
		pruneOutstandingOffers(rootTopic);
		const outstandingOffers = getRoomOutstandingOffers(rootTopic);
		const outstandingCount = keys(outstandingOffers).length;
		const missingOffers = Math.max(0, offersPerAnnounce - outstandingCount);
		if (missingOffers > 0) (await getOffers(missingOffers)).forEach((peerAndOffer) => {
			outstandingOffers[genId(hashLimit)] = {
				...peerAndOffer,
				createdAt: Date.now()
			};
		});
	})().finally(() => {
		if (roomOfferGenerationPromises[rootTopic] === nextPromise) delete roomOfferGenerationPromises[rootTopic];
	});
	roomOfferGenerationPromises[rootTopic] = nextPromise;
	await nextPromise;
	return getRoomOutstandingOffers(rootTopic);
};
const joinRoomStrategy = createStrategy({
	init: (config) => getRelays(config, defaultRelayUrls, defaultRedundancy).map((rawUrl) => {
		const client = relayManager.register(rawUrl, () => makeSocket(rawUrl, (rawData) => {
			const data = fromJson(rawData);
			const errMsg = data["failure reason"];
			const warnMsg = data["warning message"];
			const { interval } = data;
			const topic = data.info_hash ? infoHashToTopic[data.info_hash] : void 0;
			if (errMsg) {
				if (config.relayConfig?.warnOnRelayFailure !== false) warn(client.url, errMsg, true);
				return;
			}
			if (warnMsg && config.relayConfig?.warnOnRelayFailure !== false) warn(client.url, warnMsg);
			const state = topic ? topicStates.forKey(rawUrl)[topic] : void 0;
			if (interval && state) state.announceMs = Math.min(Math.max(interval * 1e3, defaultAnnounceMs), offerRetentionMs);
			if ((data.offer || data.answer) && topic && data.offer_id) {
				if (data.peer_id === selfId) return;
				const signalKey = `${topic}:${data.offer ? "offer" : "answer"}:${data.offer_id}:${data.peer_id ?? ""}`;
				const nowMs = Date.now();
				const lastHandledMs = handledSignals[signalKey];
				if (typeof lastHandledMs === "number" && nowMs - lastHandledMs < signalDedupeWindowMs) return;
				handledSignals[signalKey] = nowMs;
				entries(handledSignals).forEach(([key, handledAtMs]) => {
					if (nowMs - handledAtMs > signalDedupeWindowMs * 6) delete handledSignals[key];
				});
				state?.handler(data);
			}
		}, () => Object.values(topicStates.forKey(rawUrl)).forEach((state) => void state.announce())));
		return client.ready;
	}),
	subscribe: (client, rootTopic, _, onMessage, getOffers, context) => {
		const states = topicStates.forRelay(client);
		const subscriptionToken = Symbol(rootTopic);
		roomSubscriberCounts[rootTopic] = (roomSubscriberCounts[rootTopic] ?? 0) + 1;
		let passiveAnnounceTimeout;
		const stopPassiveAnnouncements = () => {
			clearTimeout(passiveAnnounceTimeout);
			passiveAnnounceTimeout = void 0;
		};
		const topicState = {
			announce: async () => {
				if (states[rootTopic]?.token !== subscriptionToken) return;
				if (!topicState.isActive) {
					send(client, rootTopic, {
						left: 0,
						numwant: requestedPeers,
						offers: []
					});
					return;
				}
				let outstandingOffers;
				try {
					outstandingOffers = await ensureOutstandingOffers(rootTopic, getOffers);
				} catch (error) {
					if (states[rootTopic]?.token !== subscriptionToken) return;
					throw error;
				}
				if (states[rootTopic]?.token !== subscriptionToken || !topicState.isActive) return;
				const offers = entries(outstandingOffers).map(([id, { offer }]) => ({
					offer_id: id,
					offer: {
						type: "offer",
						sdp: offer
					}
				}));
				send(client, rootTopic, {
					numwant: requestedPeers,
					offers
				});
			},
			announceMs: defaultAnnounceMs,
			handler: (data) => {
				if (data.offer && data.peer_id && data.offer_id) onMessage(rootTopic, {
					offer: data.offer.sdp,
					offerId: data.offer_id,
					peerId: data.peer_id
				}, (_, signal) => void send(client, rootTopic, {
					answer: {
						type: "answer",
						sdp: fromJson(signal).answer
					},
					offer_id: data.offer_id,
					to_peer_id: data.peer_id
				}));
				else if (data.answer && data.offer_id && data.peer_id) {
					const offer = takeOutstandingOffer(rootTopic, data.offer_id, "claim");
					if (offer) {
						onMessage(rootTopic, {
							answer: data.answer.sdp,
							offerId: data.offer_id,
							peerId: data.peer_id,
							peer: offer.peer
						}, () => {});
						topicState.announce();
					}
				}
			},
			isActive: !context?.isPassive,
			startPassiveAnnouncements: () => {
				stopPassiveAnnouncements();
				if (states[rootTopic]?.token !== subscriptionToken || topicState.isActive) return;
				topicState.announce();
				passiveAnnounceTimeout = setTimeout(topicState.startPassiveAnnouncements, Math.max(topicState.announceMs, dormantAnnounceMs));
			},
			stopPassiveAnnouncements,
			token: subscriptionToken
		};
		states[rootTopic] = topicState;
		if (!topicState.isActive) topicState.startPassiveAnnouncements();
		return () => {
			topicState.stopPassiveAnnouncements();
			roomSubscriberCounts[rootTopic] = Math.max(0, (roomSubscriberCounts[rootTopic] ?? 1) - 1);
			if (!roomSubscriberCounts[rootTopic]) {
				delete roomSubscriberCounts[rootTopic];
				reclaimAllOutstandingOffers(rootTopic);
			}
			if (states[rootTopic]?.token === subscriptionToken) delete states[rootTopic];
		};
	},
	announce: async (client, rootTopic) => {
		const state = topicStates.forRelay(client)[rootTopic];
		if (state) {
			state.stopPassiveAnnouncements();
			state.isActive = true;
			await state.announce();
		}
		return state?.announceMs ?? defaultAnnounceMs;
	},
	deactivate: (client, rootTopic) => {
		const state = topicStates.forRelay(client)[rootTopic];
		if (state) state.isActive = false;
		reclaimAllOutstandingOffers(rootTopic);
		state?.startPassiveAnnouncements();
	}
});
const joinRoom = (config, roomId, callbacks) => joinRoomStrategy({
	...config,
	trickleIce: config.trickleIce ?? false
}, roomId, callbacks);
const getRelaySockets = relayManager.getSockets;
const defaultRelayUrls = [
	"open.ftorrent.com",
	"tracker.webtorrent.dev",
	"tracker.openwebtorrent.com",
	"tracker.btorrent.xyz",
	"tracker.files.fm:7073/announce"
].map((url) => "wss://" + url);
//#endregion
export { defaultRelayUrls, getRelaySockets, joinRoom, pauseRelayReconnection, resumeRelayReconnection, selfId };

