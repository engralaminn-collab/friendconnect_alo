const functions = require('firebase-functions');
const admin = require('firebase-admin');
admin.initializeApp();

exports.sendNotificationOnMessage = functions.firestore
    .document('chats/{chatId}/messages/{messageId}')
    .onCreate(async (snap, context) => {
        const message = snap.data();
        const receiverId = message.receiverId;

        if (!receiverId) return null;

        const userDoc = await admin.firestore().collection('users').doc(receiverId).get();
        if (!userDoc.exists) return null;

        const fcmToken = userDoc.data().fcmToken;
        if (!fcmToken) return null;

        const senderDoc = await admin.firestore().collection('users').doc(message.senderId).get();
        const senderName = senderDoc.exists ? senderDoc.data().name : 'Someone';

        let body = message.text || 'Sent an attachment';

        const payload = {
            notification: {
                title: `New message from ${senderName}`,
                body: body,
            },
            data: {
                click_action: 'FLUTTER_NOTIFICATION_CLICK',
                type: 'chat',
                chatId: context.params.chatId
            }
        };

        try {
            await admin.messaging().sendToDevice(fcmToken, payload);
            console.log('Notification sent successfully');
        } catch (error) {
            console.error('Error sending notification:', error);
        }
        return null;
    });

exports.sendNotificationOnFriendRequest = functions.firestore
    .document('friendRequests/{requestId}')
    .onCreate(async (snap, context) => {
        const request = snap.data();
        const receiverId = request.receiverId;

        if (!receiverId) return null;

        const userDoc = await admin.firestore().collection('users').doc(receiverId).get();
        if (!userDoc.exists) return null;

        const fcmToken = userDoc.data().fcmToken;
        if (!fcmToken) return null;

        const senderDoc = await admin.firestore().collection('users').doc(request.senderId).get();
        const senderName = senderDoc.exists ? senderDoc.data().name : 'Someone';

        const payload = {
            notification: {
                title: 'New Friend Request',
                body: `${senderName} sent you a friend request.`,
            },
            data: {
                click_action: 'FLUTTER_NOTIFICATION_CLICK',
                type: 'friend_request',
            }
        };

        try {
            await admin.messaging().sendToDevice(fcmToken, payload);
        } catch (error) {
            console.error('Error sending notification:', error);
        }
        return null;
    });

exports.sendNotificationOnCall = functions.firestore
    .document('calls/{callId}')
    .onCreate(async (snap, context) => {
        const call = snap.data();
        const receiverId = call.receiverId;

        if (!receiverId) return null;

        const userDoc = await admin.firestore().collection('users').doc(receiverId).get();
        if (!userDoc.exists) return null;

        const fcmToken = userDoc.data().fcmToken;
        if (!fcmToken) return null;

        const senderDoc = await admin.firestore().collection('users').doc(call.callerId).get();
        const senderName = senderDoc.exists ? senderDoc.data().name : 'Someone';

        const isVideo = call.isVideo ? 'Video' : 'Voice';

        const payload = {
            notification: {
                title: `Incoming ${isVideo} Call`,
                body: `${senderName} is calling you.`,
            },
            data: {
                click_action: 'FLUTTER_NOTIFICATION_CLICK',
                type: 'call',
                callId: context.params.callId
            }
        };

        try {
            await admin.messaging().sendToDevice(fcmToken, payload);
        } catch (error) {
            console.error('Error sending notification:', error);
        }
        return null;
    });
