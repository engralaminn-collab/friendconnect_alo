/**
 * GENERATED FILE — DO NOT EDIT BY HAND.
 *
 * Produced from prisma/schema.prisma by scripts/generate-schema-metadata.mjs.
 * Consumed by src/lib/db-runtime.js (the SQLite fallback data layer).
 * CI verifies it matches the canonical schema (scripts/check-schema-drift.mjs).
 */
'use strict'

const { randomUUID } = require('crypto')

function cuid() {
  return 'c' + Date.now().toString(36) + Math.random().toString(36).slice(2, 10) + randomUUID().slice(0, 8)
}

const MODELS = {
  "user": {
    model: "User",
    table: "User",
    dates: ["lastSeenAt","createdAt","updatedAt","otpExpiry"],
    bools: ["emailVerified","twoFactorEnabled"],
    uniques: {},
    defaults: () => ({
      id: cuid(),
      status: "",
      role: "user",
      emailVerified: false,
      lastSeenAt: new Date(),
      createdAt: new Date(),
      updatedAt: new Date(),
      twoFactorEnabled: false,
      fileUsedBytes: 0,
      fileQuotaBytes: 104857600,
    }),
  },
  "verificationToken": {
    model: "VerificationToken",
    table: "VerificationToken",
    dates: ["expires"],
    bools: [],
    uniques: {},
    defaults: () => ({
      id: cuid(),
    }),
  },
  "session": {
    model: "Session",
    table: "Session",
    dates: ["expiresAt","createdAt","lastActiveAt"],
    bools: [],
    uniques: {},
    defaults: () => ({
      id: cuid(),
      createdAt: new Date(),
      lastActiveAt: new Date(),
    }),
  },
  "profile": {
    model: "Profile",
    table: "Profile",
    dates: ["birthday","lastSeen"],
    bools: ["readReceipts"],
    uniques: {},
    defaults: () => ({
      id: cuid(),
      lastSeen: new Date(),
      profileVisibility: "PUBLIC",
      messagePermission: "FRIENDS",
      callPermission: "FRIENDS",
      readReceipts: true,
      verified: "unverified",
    }),
  },
  "friendship": {
    model: "Friendship",
    table: "Friendship",
    dates: ["createdAt","updatedAt"],
    bools: ["isCloseFriend","storiesMuted"],
    uniques: {"requesterId_receiverId":["requesterId","receiverId"]},
    defaults: () => ({
      id: cuid(),
      status: "PENDING",
      isCloseFriend: false,
      storiesMuted: false,
      createdAt: new Date(),
      updatedAt: new Date(),
    }),
  },
  "message": {
    model: "Message",
    table: "Message",
    dates: ["editedAt","seenAt","scheduledFor","expiresAt","createdAt","updatedAt"],
    bools: ["edited"],
    uniques: {},
    defaults: () => ({
      id: cuid(),
      type: "text",
      status: "SENT",
      edited: false,
      createdAt: new Date(),
      updatedAt: new Date(),
    }),
  },
  "messageStar": {
    model: "MessageStar",
    table: "MessageStar",
    dates: ["createdAt"],
    bools: [],
    uniques: {"messageId_userId":["messageId","userId"]},
    defaults: () => ({
      id: cuid(),
      createdAt: new Date(),
    }),
  },
  "messageReaction": {
    model: "MessageReaction",
    table: "MessageReaction",
    dates: ["createdAt"],
    bools: [],
    uniques: {"messageId_userId_emoji":["messageId","userId","emoji"]},
    defaults: () => ({
      id: cuid(),
      createdAt: new Date(),
    }),
  },
  "messageDraft": {
    model: "MessageDraft",
    table: "MessageDraft",
    dates: ["createdAt","updatedAt"],
    bools: ["isGroup"],
    uniques: {"userId_peerId_isGroup":["userId","peerId","isGroup"]},
    defaults: () => ({
      id: cuid(),
      isGroup: false,
      createdAt: new Date(),
      updatedAt: new Date(),
    }),
  },
  "messageReminder": {
    model: "MessageReminder",
    table: "MessageReminder",
    dates: ["remindAt","createdAt"],
    bools: ["notified"],
    uniques: {},
    defaults: () => ({
      id: cuid(),
      notified: false,
      createdAt: new Date(),
    }),
  },
  "chatPreference": {
    model: "ChatPreference",
    table: "ChatPreference",
    dates: ["createdAt","updatedAt"],
    bools: ["pinned","muted","archived"],
    uniques: {"userId_peerId":["userId","peerId"]},
    defaults: () => ({
      id: cuid(),
      pinned: false,
      muted: false,
      archived: false,
      createdAt: new Date(),
      updatedAt: new Date(),
    }),
  },
  "group": {
    model: "Group",
    table: "Group",
    dates: ["createdAt","updatedAt"],
    bools: [],
    uniques: {},
    defaults: () => ({
      id: cuid(),
      createdAt: new Date(),
      updatedAt: new Date(),
    }),
  },
  "groupMember": {
    model: "GroupMember",
    table: "GroupMember",
    dates: ["joinedAt"],
    bools: [],
    uniques: {"groupId_userId":["groupId","userId"]},
    defaults: () => ({
      id: cuid(),
      role: "member",
      joinedAt: new Date(),
    }),
  },
  "call": {
    model: "Call",
    table: "Call",
    dates: ["startedAt","endedAt","createdAt"],
    bools: [],
    uniques: {},
    defaults: () => ({
      id: cuid(),
      status: "ringing",
      createdAt: new Date(),
    }),
  },
  "file": {
    model: "File",
    table: "File",
    dates: ["createdAt"],
    bools: [],
    uniques: {},
    defaults: () => ({
      id: cuid(),
      createdAt: new Date(),
    }),
  },
  "notification": {
    model: "Notification",
    table: "Notification",
    dates: ["createdAt"],
    bools: ["read"],
    uniques: {},
    defaults: () => ({
      id: cuid(),
      read: false,
      createdAt: new Date(),
    }),
  },
  "story": {
    model: "Story",
    table: "Story",
    dates: ["expiresAt","createdAt"],
    bools: ["isHighlight"],
    uniques: {},
    defaults: () => ({
      id: cuid(),
      mediaType: "image",
      type: "text",
      isHighlight: false,
      createdAt: new Date(),
    }),
  },
  "storyView": {
    model: "StoryView",
    table: "StoryView",
    dates: ["viewedAt","createdAt"],
    bools: [],
    uniques: {"storyId_userId":["storyId","userId"]},
    defaults: () => ({
      id: cuid(),
      viewedAt: new Date(),
      createdAt: new Date(),
    }),
  },
  "storyReply": {
    model: "StoryReply",
    table: "StoryReply",
    dates: ["createdAt"],
    bools: [],
    uniques: {},
    defaults: () => ({
      id: cuid(),
      createdAt: new Date(),
    }),
  },
  "storyReaction": {
    model: "StoryReaction",
    table: "StoryReaction",
    dates: ["createdAt"],
    bools: [],
    uniques: {"storyId_userId_emoji":["storyId","userId","emoji"]},
    defaults: () => ({
      id: cuid(),
      createdAt: new Date(),
    }),
  },
  "broadcastList": {
    model: "BroadcastList",
    table: "BroadcastList",
    dates: ["createdAt"],
    bools: [],
    uniques: {},
    defaults: () => ({
      id: cuid(),
      createdAt: new Date(),
    }),
  },
  "broadcastMember": {
    model: "BroadcastMember",
    table: "BroadcastMember",
    dates: ["createdAt"],
    bools: [],
    uniques: {},
    defaults: () => ({
      id: cuid(),
      createdAt: new Date(),
    }),
  },
  "pushSubscription": {
    model: "PushSubscription",
    table: "PushSubscription",
    dates: ["createdAt","updatedAt"],
    bools: [],
    uniques: {"userId_endpoint":["userId","endpoint"]},
    defaults: () => ({
      id: cuid(),
      createdAt: new Date(),
      updatedAt: new Date(),
    }),
  },
  "auditLog": {
    model: "AuditLog",
    table: "AuditLog",
    dates: ["createdAt"],
    bools: [],
    uniques: {},
    defaults: () => ({
      id: cuid(),
      createdAt: new Date(),
    }),
  },
  "post": {
    model: "Post",
    table: "Post",
    dates: ["createdAt","updatedAt"],
    bools: [],
    uniques: {},
    defaults: () => ({
      id: cuid(),
      visibility: "friends",
      createdAt: new Date(),
      updatedAt: new Date(),
    }),
  },
  "postComment": {
    model: "PostComment",
    table: "PostComment",
    dates: ["createdAt"],
    bools: [],
    uniques: {},
    defaults: () => ({
      id: cuid(),
      createdAt: new Date(),
    }),
  },
  "postReaction": {
    model: "PostReaction",
    table: "PostReaction",
    dates: ["createdAt"],
    bools: [],
    uniques: {"postId_userId_emoji":["postId","userId","emoji"]},
    defaults: () => ({
      id: cuid(),
      createdAt: new Date(),
    }),
  },
  "poll": {
    model: "Poll",
    table: "Poll",
    dates: ["expiresAt","createdAt"],
    bools: [],
    uniques: {},
    defaults: () => ({
      id: cuid(),
      createdAt: new Date(),
    }),
  },
  "pollVote": {
    model: "PollVote",
    table: "PollVote",
    dates: ["createdAt"],
    bools: [],
    uniques: {"pollId_userId":["pollId","userId"]},
    defaults: () => ({
      id: cuid(),
      createdAt: new Date(),
    }),
  },
  "conversation": {
    model: "Conversation",
    table: "Conversation",
    dates: ["createdAt","updatedAt"],
    bools: [],
    uniques: {},
    defaults: () => ({
      id: cuid(),
      type: "direct",
      createdAt: new Date(),
      updatedAt: new Date(),
    }),
  },
  "conversationMember": {
    model: "ConversationMember",
    table: "ConversationMember",
    dates: ["joinedAt","lastReadAt"],
    bools: ["muted","pinned"],
    uniques: {"conversationId_userId":["conversationId","userId"]},
    defaults: () => ({
      id: cuid(),
      role: "member",
      joinedAt: new Date(),
      muted: false,
      pinned: false,
    }),
  },
  "block": {
    model: "Block",
    table: "Block",
    dates: ["createdAt"],
    bools: [],
    uniques: {"fromId_toId":["fromId","toId"]},
    defaults: () => ({
      id: cuid(),
      createdAt: new Date(),
    }),
  },
  "report": {
    model: "Report",
    table: "Report",
    dates: ["createdAt"],
    bools: [],
    uniques: {},
    defaults: () => ({
      id: cuid(),
      status: "open",
      createdAt: new Date(),
    }),
  },
  "attachment": {
    model: "Attachment",
    table: "Attachment",
    dates: ["createdAt"],
    bools: [],
    uniques: {},
    defaults: () => ({
      id: cuid(),
      createdAt: new Date(),
    }),
  },
  "fileAccess": {
    model: "FileAccess",
    table: "FileAccess",
    dates: ["createdAt","expiresAt"],
    bools: [],
    uniques: {"fileUrl_userId":["fileUrl","userId"]},
    defaults: () => ({
      id: cuid(),
      createdAt: new Date(),
    }),
  },
  "friendRequest": {
    model: "FriendRequest",
    table: "FriendRequest",
    dates: ["createdAt","updatedAt"],
    bools: [],
    uniques: {"fromId_toId":["fromId","toId"]},
    defaults: () => ({
      id: cuid(),
      status: "pending",
      createdAt: new Date(),
      updatedAt: new Date(),
    }),
  },
  "jaraConfig": {
    model: "JaraConfig",
    table: "JaraConfig",
    dates: ["createdAt","updatedAt"],
    bools: ["isEnabled","memoryEnabled","smsEnabled","callsEnabled","meetingsEnabled","allowGroupListening","humanHandoffEnabled","recordingConsentRequired","isLive"],
    uniques: {},
    defaults: () => ({
      id: cuid(),
      version: 1,
      displayName: "Jara AI",
      aiDisclosure: "I am Jara AI, a digital human assistant. I am not a real human.",
      isEnabled: true,
      face: "friendly",
      avatar: "default",
      background: "gradient-emerald",
      theme: "light",
      voiceModel: "default",
      voiceLanguage: "bn",
      speakingSpeed: 1,
      pitch: 1,
      personality: "friendly",
      responseLength: "medium",
      communicationStyle: "conversational",
      llmProvider: "ollama",
      llmModel: "llama3.2",
      sttModel: "whisper",
      ttsModel: "default",
      memoryEnabled: true,
      smsEnabled: false,
      callsEnabled: true,
      meetingsEnabled: false,
      allowGroupListening: false,
      humanHandoffEnabled: true,
      recordingConsentRequired: true,
      approvedKnowledgeMode: "open",
      isLive: false,
      createdAt: new Date(),
      updatedAt: new Date(),
    }),
  },
  "jaraProposal": {
    model: "JaraProposal",
    table: "JaraProposal",
    dates: ["createdAt","expiresAt","approvedAt","appliedAt"],
    bools: [],
    uniques: {},
    defaults: () => ({
      id: cuid(),
      status: "pending",
      createdAt: new Date(),
    }),
  },
  "jaraAuditLog": {
    model: "JaraAuditLog",
    table: "JaraAuditLog",
    dates: ["createdAt"],
    bools: [],
    uniques: {},
    defaults: () => ({
      id: cuid(),
      createdAt: new Date(),
    }),
  },
  "jaraMemory": {
    model: "JaraMemory",
    table: "JaraMemory",
    dates: ["createdAt","updatedAt"],
    bools: [],
    uniques: {"userId_key":["userId","key"]},
    defaults: () => ({
      id: cuid(),
      createdAt: new Date(),
      updatedAt: new Date(),
    }),
  },
  "jaraGroupConsent": {
    model: "JaraGroupConsent",
    table: "JaraGroupConsent",
    dates: ["consentedAt","createdAt","updatedAt"],
    bools: ["enabled","listenEnabled"],
    uniques: {},
    defaults: () => ({
      id: cuid(),
      enabled: false,
      listenEnabled: false,
      createdAt: new Date(),
      updatedAt: new Date(),
    }),
  },
  "jaraAppearanceProfile": {
    model: "JaraAppearanceProfile",
    table: "JaraAppearanceProfile",
    dates: ["expiresAt","createdAt","updatedAt"],
    bools: ["isDefault","isTemporary","isActive"],
    uniques: {},
    defaults: () => ({
      id: cuid(),
      profileType: "custom",
      isDefault: false,
      isTemporary: false,
      face: "friendly",
      avatar: "default",
      background: "gradient-emerald",
      theme: "light",
      isActive: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    }),
  },
  "jaraCallPresentation": {
    model: "JaraCallPresentation",
    table: "JaraCallPresentation",
    dates: ["expiresAt","createdAt","updatedAt"],
    bools: ["isTemporary"],
    uniques: {},
    defaults: () => ({
      id: cuid(),
      isTemporary: true,
      status: "active",
      createdAt: new Date(),
      updatedAt: new Date(),
    }),
  },
  "jaraSmsConfig": {
    model: "JaraSmsConfig",
    table: "JaraSmsConfig",
    dates: ["createdAt","updatedAt"],
    bools: ["enabled","inboundEnabled","outboundEnabled","requireHumanApproval"],
    uniques: {},
    defaults: () => ({
      id: cuid(),
      enabled: false,
      provider: "none",
      inboundEnabled: false,
      outboundEnabled: false,
      requireHumanApproval: true,
      rateLimitPerHour: 20,
      createdAt: new Date(),
      updatedAt: new Date(),
    }),
  },
  "jaraSmsContact": {
    model: "JaraSmsContact",
    table: "JaraSmsContact",
    dates: ["consentAt","optedOutAt","createdAt","updatedAt"],
    bools: [],
    uniques: {},
    defaults: () => ({
      id: cuid(),
      consentStatus: "unknown",
      createdAt: new Date(),
      updatedAt: new Date(),
    }),
  },
  "jaraSmsMessage": {
    model: "JaraSmsMessage",
    table: "JaraSmsMessage",
    dates: ["approvedAt","createdAt","updatedAt"],
    bools: ["requiresApproval","consentChecked"],
    uniques: {},
    defaults: () => ({
      id: cuid(),
      direction: "outbound",
      status: "draft",
      requiresApproval: true,
      consentChecked: false,
      createdAt: new Date(),
      updatedAt: new Date(),
    }),
  },
  "jaraDonorContribution": {
    model: "JaraDonorContribution",
    table: "JaraDonorContribution",
    dates: ["verifiedAt","acknowledgementSentAt","createdAt","updatedAt"],
    bools: ["consentToContact","privacyAccepted","isPublic"],
    uniques: {},
    defaults: () => ({
      id: cuid(),
      contributionType: "support",
      consentToContact: false,
      privacyAccepted: false,
      status: "pending_review",
      isPublic: false,
      createdAt: new Date(),
      updatedAt: new Date(),
    }),
  },
  "jaraConsentRecord": {
    model: "JaraConsentRecord",
    table: "JaraConsentRecord",
    dates: ["grantedAt","revokedAt","createdAt","updatedAt"],
    bools: [],
    uniques: {},
    defaults: () => ({
      id: cuid(),
      status: "granted",
      createdAt: new Date(),
      updatedAt: new Date(),
    }),
  },
  "jaraMeetingIntegration": {
    model: "JaraMeetingIntegration",
    table: "JaraMeetingIntegration",
    dates: ["lastCheckedAt","createdAt","updatedAt"],
    bools: ["enabled"],
    uniques: {},
    defaults: () => ({
      id: cuid(),
      enabled: false,
      authStatus: "not_configured",
      createdAt: new Date(),
      updatedAt: new Date(),
    }),
  },
  "jaraKnowledgeSource": {
    model: "JaraKnowledgeSource",
    table: "JaraKnowledgeSource",
    dates: ["approvedAt","createdAt","updatedAt"],
    bools: ["isApproved"],
    uniques: {},
    defaults: () => ({
      id: cuid(),
      sourceType: "text",
      isApproved: false,
      status: "draft",
      createdAt: new Date(),
      updatedAt: new Date(),
    }),
  },
  "jaraAsset": {
    model: "JaraAsset",
    table: "JaraAsset",
    dates: ["approvedAt","createdAt","updatedAt"],
    bools: ["isApproved"],
    uniques: {},
    defaults: () => ({
      id: cuid(),
      kind: "background",
      isApproved: false,
      status: "pending_review",
      source: "upload",
      createdAt: new Date(),
      updatedAt: new Date(),
    }),
  },
  "jaraMeetingProfile": {
    model: "JaraMeetingProfile",
    table: "JaraMeetingProfile",
    dates: ["scheduledAt","approvedAt","cancelledAt","startedAt","endedAt","createdAt","updatedAt"],
    bools: [],
    uniques: {},
    defaults: () => ({
      id: cuid(),
      meetingType: "custom_video_call",
      platform: "internal",
      status: "draft",
      scope: "meeting_specific",
      configVersion: 1,
      rendererStatus: "unconfigured",
      createdAt: new Date(),
      updatedAt: new Date(),
    }),
  },
}

/** Flat `{ table, columns[] }` view used to verify a live SQLite schema. */
const EXPECTED_COLUMNS = {}
EXPECTED_COLUMNS["User"] = { table: "User", columns: ["id","email","username","name","passwordHash","avatarUrl","bio","status","role","emailVerified","lastSeenAt","createdAt","updatedAt","twoFactorEnabled","twoFactorSecret","twoFactorBackup","otpCode","otpExpiry","fileUsedBytes","fileQuotaBytes","publicKey"] }
EXPECTED_COLUMNS["VerificationToken"] = { table: "VerificationToken", columns: ["id","identifier","token","expires"] }
EXPECTED_COLUMNS["Session"] = { table: "Session", columns: ["id","userId","sessionToken","token","expiresAt","userAgent","ipAddress","deviceName","createdAt","lastActiveAt"] }
EXPECTED_COLUMNS["Profile"] = { table: "Profile", columns: ["id","userId","photoUrl","bio","phone","location","birthday","education","work","lastSeen","profileVisibility","messagePermission","callPermission","readReceipts","photoFilter","verified"] }
EXPECTED_COLUMNS["Friendship"] = { table: "Friendship", columns: ["id","requesterId","receiverId","status","blockerId","isCloseFriend","storiesMuted","createdAt","updatedAt"] }
EXPECTED_COLUMNS["Message"] = { table: "Message", columns: ["id","senderId","receiverId","groupId","conversationId","content","type","fileUrl","fileName","fileSize","mimeType","replyToId","forwardedFrom","status","deletedFor","edited","editedAt","pinnedBy","seenAt","scheduledFor","expiresAt","metadata","createdAt","updatedAt"] }
EXPECTED_COLUMNS["MessageStar"] = { table: "MessageStar", columns: ["id","messageId","userId","createdAt"] }
EXPECTED_COLUMNS["MessageReaction"] = { table: "MessageReaction", columns: ["id","messageId","userId","emoji","createdAt"] }
EXPECTED_COLUMNS["MessageDraft"] = { table: "MessageDraft", columns: ["id","userId","peerId","isGroup","content","createdAt","updatedAt"] }
EXPECTED_COLUMNS["MessageReminder"] = { table: "MessageReminder", columns: ["id","messageId","userId","remindAt","notified","createdAt"] }
EXPECTED_COLUMNS["ChatPreference"] = { table: "ChatPreference", columns: ["id","userId","peerId","pinned","muted","archived","disappearing","wallpaper","folder","createdAt","updatedAt"] }
EXPECTED_COLUMNS["Group"] = { table: "Group", columns: ["id","name","description","photoUrl","createdBy","ownerId","createdAt","updatedAt"] }
EXPECTED_COLUMNS["GroupMember"] = { table: "GroupMember", columns: ["id","groupId","userId","role","joinedAt"] }
EXPECTED_COLUMNS["Call"] = { table: "Call", columns: ["id","callerId","receiverId","type","status","startedAt","endedAt","duration","failureReason","connectionType","createdAt"] }
EXPECTED_COLUMNS["File"] = { table: "File", columns: ["id","ownerId","name","filename","mimeType","size","url","thumbUrl","createdAt"] }
EXPECTED_COLUMNS["Notification"] = { table: "Notification", columns: ["id","userId","type","title","body","data","link","read","createdAt"] }
EXPECTED_COLUMNS["Story"] = { table: "Story", columns: ["id","userId","mediaUrl","mediaType","type","content","bg","caption","isHighlight","expiresAt","createdAt"] }
EXPECTED_COLUMNS["StoryView"] = { table: "StoryView", columns: ["id","storyId","userId","viewedAt","createdAt"] }
EXPECTED_COLUMNS["StoryReply"] = { table: "StoryReply", columns: ["id","storyId","userId","content","createdAt"] }
EXPECTED_COLUMNS["StoryReaction"] = { table: "StoryReaction", columns: ["id","storyId","userId","emoji","createdAt"] }
EXPECTED_COLUMNS["BroadcastList"] = { table: "BroadcastList", columns: ["id","ownerId","name","createdAt"] }
EXPECTED_COLUMNS["BroadcastMember"] = { table: "BroadcastMember", columns: ["id","broadcastListId","recipientId","createdAt"] }
EXPECTED_COLUMNS["PushSubscription"] = { table: "PushSubscription", columns: ["id","userId","endpoint","p256dh","auth","keys","userAgent","createdAt","updatedAt"] }
EXPECTED_COLUMNS["AuditLog"] = { table: "AuditLog", columns: ["id","userId","action","entity","entityId","resource","ip","userAgent","detail","meta","createdAt"] }
EXPECTED_COLUMNS["Post"] = { table: "Post", columns: ["id","authorId","content","mediaUrl","visibility","createdAt","updatedAt"] }
EXPECTED_COLUMNS["PostComment"] = { table: "PostComment", columns: ["id","postId","authorId","content","createdAt"] }
EXPECTED_COLUMNS["PostReaction"] = { table: "PostReaction", columns: ["id","postId","userId","emoji","createdAt"] }
EXPECTED_COLUMNS["Poll"] = { table: "Poll", columns: ["id","messageId","question","options","expiresAt","createdAt"] }
EXPECTED_COLUMNS["PollVote"] = { table: "PollVote", columns: ["id","pollId","userId","optionIdx","createdAt"] }
EXPECTED_COLUMNS["Conversation"] = { table: "Conversation", columns: ["id","type","title","avatarUrl","description","ownerId","createdAt","updatedAt"] }
EXPECTED_COLUMNS["ConversationMember"] = { table: "ConversationMember", columns: ["id","conversationId","userId","role","joinedAt","lastReadAt","muted","pinned"] }
EXPECTED_COLUMNS["Block"] = { table: "Block", columns: ["id","fromId","toId","createdAt"] }
EXPECTED_COLUMNS["Report"] = { table: "Report", columns: ["id","fromId","toId","reason","detail","status","createdAt"] }
EXPECTED_COLUMNS["Attachment"] = { table: "Attachment", columns: ["id","messageId","ownerId","filename","mimeType","size","url","thumbUrl","createdAt"] }
EXPECTED_COLUMNS["FileAccess"] = { table: "FileAccess", columns: ["id","fileUrl","userId","source","messageId","createdAt","expiresAt"] }
EXPECTED_COLUMNS["FriendRequest"] = { table: "FriendRequest", columns: ["id","fromId","toId","message","status","createdAt","updatedAt"] }
EXPECTED_COLUMNS["JaraConfig"] = { table: "JaraConfig", columns: ["id","version","displayName","aiDisclosure","isEnabled","face","avatar","avatarUrl","background","backgroundUrl","theme","colors","animation","clothing","defaultAppearanceProfileId","voiceModel","voiceLanguage","voiceAccent","speakingSpeed","pitch","personality","responseLength","communicationStyle","llmProvider","llmModel","sttModel","ttsModel","memoryEnabled","smsEnabled","callsEnabled","meetingsEnabled","allowGroupListening","humanHandoffEnabled","recordingConsentRequired","approvedKnowledgeMode","isLive","createdBy","createdAt","updatedAt"] }
EXPECTED_COLUMNS["JaraProposal"] = { table: "JaraProposal", columns: ["id","version","previousVersion","configJson","configHash","status","createdBy","createdAt","expiresAt","approvedBy","approvedAt","appliedAt","changeSummary"] }
EXPECTED_COLUMNS["JaraAuditLog"] = { table: "JaraAuditLog", columns: ["id","proposalId","version","action","actorId","actorRole","detail","previousValue","newValue","authorizationResult","changeReason","requestId","sessionId","ip","userAgent","createdAt"] }
EXPECTED_COLUMNS["JaraMemory"] = { table: "JaraMemory", columns: ["id","userId","key","value","createdAt","updatedAt"] }
EXPECTED_COLUMNS["JaraGroupConsent"] = { table: "JaraGroupConsent", columns: ["id","groupId","enabled","listenEnabled","consentedBy","consentedAt","createdAt","updatedAt"] }
EXPECTED_COLUMNS["JaraAppearanceProfile"] = { table: "JaraAppearanceProfile", columns: ["id","name","description","profileType","isDefault","isTemporary","expiresAt","face","avatar","avatarUrl","background","backgroundUrl","theme","colors","clothing","animation","voiceModel","voiceLanguage","speakingSpeed","pitch","personality","communicationStyle","createdBy","updatedBy","isActive","createdAt","updatedAt"] }
EXPECTED_COLUMNS["JaraCallPresentation"] = { table: "JaraCallPresentation", columns: ["id","sessionType","sessionId","roomId","profileId","profileSnapshot","isTemporary","expiresAt","status","createdBy","createdAt","updatedAt"] }
EXPECTED_COLUMNS["JaraSmsConfig"] = { table: "JaraSmsConfig", columns: ["id","enabled","provider","senderId","webhookSecret","inboundEnabled","outboundEnabled","requireHumanApproval","allowedCountries","rateLimitPerHour","optOutKeywords","createdBy","updatedBy","createdAt","updatedAt"] }
EXPECTED_COLUMNS["JaraSmsContact"] = { table: "JaraSmsContact", columns: ["id","phoneNumber","name","email","consentStatus","consentAt","consentSource","optedOutAt","notes","createdBy","createdAt","updatedAt"] }
EXPECTED_COLUMNS["JaraSmsMessage"] = { table: "JaraSmsMessage", columns: ["id","contactId","direction","fromNumber","toNumber","body","language","status","provider","providerMessageId","errorMessage","requiresApproval","approvedBy","approvedAt","consentChecked","metadata","createdBy","createdAt","updatedAt"] }
EXPECTED_COLUMNS["JaraDonorContribution"] = { table: "JaraDonorContribution", columns: ["id","fullName","email","country","contributionType","amount","currency","message","consentToContact","privacyAccepted","status","verifiedBy","verifiedAt","acknowledgementSentAt","isPublic","adminNotes","createdAt","updatedAt"] }
EXPECTED_COLUMNS["JaraConsentRecord"] = { table: "JaraConsentRecord", columns: ["id","subjectType","subjectId","subjectLabel","consentType","status","source","details","grantedAt","revokedAt","recordedBy","createdAt","updatedAt"] }
EXPECTED_COLUMNS["JaraMeetingIntegration"] = { table: "JaraMeetingIntegration", columns: ["id","platform","displayName","enabled","config","authStatus","lastCheckedAt","createdBy","updatedBy","createdAt","updatedAt"] }
EXPECTED_COLUMNS["JaraKnowledgeSource"] = { table: "JaraKnowledgeSource", columns: ["id","title","sourceType","content","sourceUrl","language","tags","isApproved","approvedBy","approvedAt","status","createdBy","updatedBy","createdAt","updatedAt"] }
EXPECTED_COLUMNS["JaraAsset"] = { table: "JaraAsset", columns: ["id","kind","name","description","fileUrl","storageKey","mimeType","fileSize","width","height","sha256","isApproved","approvedBy","approvedAt","status","source","ownerId","metadata","createdBy","updatedBy","createdAt","updatedAt"] }
EXPECTED_COLUMNS["JaraMeetingProfile"] = { table: "JaraMeetingProfile", columns: ["id","title","purpose","meetingType","scheduledAt","durationMinutes","platform","participants","appearanceProfileId","clothing","background","backgroundUrl","avatarStyle","presentationStyle","voiceLanguage","voiceProfile","speakingStyle","script","talkingPoints","instructions","referenceImageAssetId","referenceVideoAssetId","voiceSampleAssetId","referenceImageUrl","referenceVideoUrl","voiceSampleUrl","status","scope","approvedBy","approvedAt","cancelledAt","startedAt","endedAt","configVersion","configSnapshot","rendererStatus","createdBy","updatedBy","createdAt","updatedAt"] }

module.exports = { MODELS, EXPECTED_COLUMNS, cuid }
