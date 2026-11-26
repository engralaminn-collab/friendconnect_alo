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
    dates: ["lastSeenAt","createdAt","updatedAt","otpExpiry","otpSentAt","resetTokenExpiry"],
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
      twoFactorBackupUsed: 0,
      twoFactorAttempts: 0,
      otpAttempts: 0,
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
      face: "realistic",
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
      face: "realistic",
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
EXPECTED_COLUMNS["user"] = { table: "User", columns: ["id","email","username","name","passwordHash","avatarUrl","bio","status","role","emailVerified","lastSeenAt","createdAt","updatedAt","twoFactorEnabled","twoFactorSecret","twoFactorConfirmedSecret","twoFactorBackup","twoFactorBackupUsed","twoFactorAttempts","otpCode","otpExpiry","otpAttempts","otpSentAt","resetTokenHash","resetTokenExpiry","fileUsedBytes","fileQuotaBytes","publicKey"] }
EXPECTED_COLUMNS["verificationToken"] = { table: "VerificationToken", columns: ["id","identifier","token","expires"] }
EXPECTED_COLUMNS["session"] = { table: "Session", columns: ["id","userId","sessionToken","token","expiresAt","userAgent","ipAddress","deviceName","createdAt","lastActiveAt"] }
EXPECTED_COLUMNS["profile"] = { table: "Profile", columns: ["id","userId","photoUrl","bio","phone","location","birthday","education","work","lastSeen","profileVisibility","messagePermission","callPermission","readReceipts","photoFilter","verified"] }
EXPECTED_COLUMNS["friendship"] = { table: "Friendship", columns: ["id","requesterId","receiverId","status","blockerId","isCloseFriend","storiesMuted","createdAt","updatedAt"] }
EXPECTED_COLUMNS["message"] = { table: "Message", columns: ["id","senderId","receiverId","groupId","conversationId","content","type","fileUrl","fileName","fileSize","mimeType","replyToId","forwardedFrom","status","deletedFor","edited","editedAt","pinnedBy","seenAt","scheduledFor","expiresAt","metadata","createdAt","updatedAt"] }
EXPECTED_COLUMNS["messageStar"] = { table: "MessageStar", columns: ["id","messageId","userId","createdAt"] }
EXPECTED_COLUMNS["messageReaction"] = { table: "MessageReaction", columns: ["id","messageId","userId","emoji","createdAt"] }
EXPECTED_COLUMNS["messageDraft"] = { table: "MessageDraft", columns: ["id","userId","peerId","isGroup","content","createdAt","updatedAt"] }
EXPECTED_COLUMNS["messageReminder"] = { table: "MessageReminder", columns: ["id","messageId","userId","remindAt","notified","createdAt"] }
EXPECTED_COLUMNS["chatPreference"] = { table: "ChatPreference", columns: ["id","userId","peerId","pinned","muted","archived","disappearing","wallpaper","folder","createdAt","updatedAt"] }
EXPECTED_COLUMNS["group"] = { table: "Group", columns: ["id","name","description","photoUrl","createdBy","ownerId","createdAt","updatedAt"] }
EXPECTED_COLUMNS["groupMember"] = { table: "GroupMember", columns: ["id","groupId","userId","role","joinedAt"] }
EXPECTED_COLUMNS["call"] = { table: "Call", columns: ["id","callerId","receiverId","type","status","startedAt","endedAt","duration","failureReason","connectionType","createdAt"] }
EXPECTED_COLUMNS["file"] = { table: "File", columns: ["id","ownerId","name","filename","mimeType","size","url","thumbUrl","createdAt"] }
EXPECTED_COLUMNS["notification"] = { table: "Notification", columns: ["id","userId","type","title","body","data","link","read","createdAt"] }
EXPECTED_COLUMNS["story"] = { table: "Story", columns: ["id","userId","mediaUrl","mediaType","type","content","bg","caption","isHighlight","expiresAt","createdAt"] }
EXPECTED_COLUMNS["storyView"] = { table: "StoryView", columns: ["id","storyId","userId","viewedAt","createdAt"] }
EXPECTED_COLUMNS["storyReply"] = { table: "StoryReply", columns: ["id","storyId","userId","content","createdAt"] }
EXPECTED_COLUMNS["storyReaction"] = { table: "StoryReaction", columns: ["id","storyId","userId","emoji","createdAt"] }
EXPECTED_COLUMNS["broadcastList"] = { table: "BroadcastList", columns: ["id","ownerId","name","createdAt"] }
EXPECTED_COLUMNS["broadcastMember"] = { table: "BroadcastMember", columns: ["id","broadcastListId","recipientId","createdAt"] }
EXPECTED_COLUMNS["pushSubscription"] = { table: "PushSubscription", columns: ["id","userId","endpoint","p256dh","auth","keys","userAgent","createdAt","updatedAt"] }
EXPECTED_COLUMNS["auditLog"] = { table: "AuditLog", columns: ["id","userId","action","entity","entityId","resource","ip","userAgent","detail","meta","createdAt"] }
EXPECTED_COLUMNS["post"] = { table: "Post", columns: ["id","authorId","content","mediaUrl","visibility","createdAt","updatedAt"] }
EXPECTED_COLUMNS["postComment"] = { table: "PostComment", columns: ["id","postId","authorId","content","createdAt"] }
EXPECTED_COLUMNS["postReaction"] = { table: "PostReaction", columns: ["id","postId","userId","emoji","createdAt"] }
EXPECTED_COLUMNS["poll"] = { table: "Poll", columns: ["id","messageId","question","options","expiresAt","createdAt"] }
EXPECTED_COLUMNS["pollVote"] = { table: "PollVote", columns: ["id","pollId","userId","optionIdx","createdAt"] }
EXPECTED_COLUMNS["conversation"] = { table: "Conversation", columns: ["id","type","title","avatarUrl","description","ownerId","createdAt","updatedAt"] }
EXPECTED_COLUMNS["conversationMember"] = { table: "ConversationMember", columns: ["id","conversationId","userId","role","joinedAt","lastReadAt","muted","pinned"] }
EXPECTED_COLUMNS["block"] = { table: "Block", columns: ["id","fromId","toId","createdAt"] }
EXPECTED_COLUMNS["report"] = { table: "Report", columns: ["id","fromId","toId","reason","detail","status","createdAt"] }
EXPECTED_COLUMNS["attachment"] = { table: "Attachment", columns: ["id","messageId","ownerId","filename","mimeType","size","url","thumbUrl","createdAt"] }
EXPECTED_COLUMNS["fileAccess"] = { table: "FileAccess", columns: ["id","fileUrl","userId","source","messageId","createdAt","expiresAt"] }
EXPECTED_COLUMNS["friendRequest"] = { table: "FriendRequest", columns: ["id","fromId","toId","message","status","createdAt","updatedAt"] }
EXPECTED_COLUMNS["jaraConfig"] = { table: "JaraConfig", columns: ["id","version","displayName","aiDisclosure","isEnabled","face","avatar","avatarUrl","background","backgroundUrl","theme","colors","animation","clothing","defaultAppearanceProfileId","voiceModel","voiceLanguage","voiceAccent","speakingSpeed","pitch","personality","responseLength","communicationStyle","llmProvider","llmModel","sttModel","ttsModel","memoryEnabled","smsEnabled","callsEnabled","meetingsEnabled","allowGroupListening","humanHandoffEnabled","recordingConsentRequired","approvedKnowledgeMode","isLive","createdBy","createdAt","updatedAt"] }
EXPECTED_COLUMNS["jaraProposal"] = { table: "JaraProposal", columns: ["id","version","previousVersion","configJson","configHash","status","createdBy","createdAt","expiresAt","approvedBy","approvedAt","appliedAt","changeSummary"] }
EXPECTED_COLUMNS["jaraAuditLog"] = { table: "JaraAuditLog", columns: ["id","proposalId","version","action","actorId","actorRole","detail","previousValue","newValue","authorizationResult","changeReason","requestId","sessionId","ip","userAgent","createdAt"] }
EXPECTED_COLUMNS["jaraMemory"] = { table: "JaraMemory", columns: ["id","userId","key","value","createdAt","updatedAt"] }
EXPECTED_COLUMNS["jaraGroupConsent"] = { table: "JaraGroupConsent", columns: ["id","groupId","enabled","listenEnabled","consentedBy","consentedAt","createdAt","updatedAt"] }
EXPECTED_COLUMNS["jaraAppearanceProfile"] = { table: "JaraAppearanceProfile", columns: ["id","name","description","profileType","isDefault","isTemporary","expiresAt","face","avatar","avatarUrl","background","backgroundUrl","theme","colors","clothing","animation","voiceModel","voiceLanguage","speakingSpeed","pitch","personality","communicationStyle","createdBy","updatedBy","isActive","createdAt","updatedAt"] }
EXPECTED_COLUMNS["jaraCallPresentation"] = { table: "JaraCallPresentation", columns: ["id","sessionType","sessionId","roomId","profileId","profileSnapshot","isTemporary","expiresAt","status","createdBy","createdAt","updatedAt"] }
EXPECTED_COLUMNS["jaraSmsConfig"] = { table: "JaraSmsConfig", columns: ["id","enabled","provider","senderId","webhookSecret","inboundEnabled","outboundEnabled","requireHumanApproval","allowedCountries","rateLimitPerHour","optOutKeywords","createdBy","updatedBy","createdAt","updatedAt"] }
EXPECTED_COLUMNS["jaraSmsContact"] = { table: "JaraSmsContact", columns: ["id","phoneNumber","name","email","consentStatus","consentAt","consentSource","optedOutAt","notes","createdBy","createdAt","updatedAt"] }
EXPECTED_COLUMNS["jaraSmsMessage"] = { table: "JaraSmsMessage", columns: ["id","contactId","direction","fromNumber","toNumber","body","language","status","provider","providerMessageId","errorMessage","requiresApproval","approvedBy","approvedAt","consentChecked","metadata","createdBy","createdAt","updatedAt"] }
EXPECTED_COLUMNS["jaraDonorContribution"] = { table: "JaraDonorContribution", columns: ["id","fullName","email","country","contributionType","amount","currency","message","consentToContact","privacyAccepted","status","verifiedBy","verifiedAt","acknowledgementSentAt","isPublic","adminNotes","createdAt","updatedAt"] }
EXPECTED_COLUMNS["jaraConsentRecord"] = { table: "JaraConsentRecord", columns: ["id","subjectType","subjectId","subjectLabel","consentType","status","source","details","grantedAt","revokedAt","recordedBy","createdAt","updatedAt"] }
EXPECTED_COLUMNS["jaraMeetingIntegration"] = { table: "JaraMeetingIntegration", columns: ["id","platform","displayName","enabled","config","authStatus","lastCheckedAt","createdBy","updatedBy","createdAt","updatedAt"] }
EXPECTED_COLUMNS["jaraKnowledgeSource"] = { table: "JaraKnowledgeSource", columns: ["id","title","sourceType","content","sourceUrl","language","tags","isApproved","approvedBy","approvedAt","status","createdBy","updatedBy","createdAt","updatedAt"] }
EXPECTED_COLUMNS["jaraAsset"] = { table: "JaraAsset", columns: ["id","kind","name","description","fileUrl","storageKey","mimeType","fileSize","width","height","sha256","isApproved","approvedBy","approvedAt","status","source","ownerId","metadata","createdBy","updatedBy","createdAt","updatedAt"] }
EXPECTED_COLUMNS["jaraMeetingProfile"] = { table: "JaraMeetingProfile", columns: ["id","title","purpose","meetingType","scheduledAt","durationMinutes","platform","participants","appearanceProfileId","clothing","background","backgroundUrl","avatarStyle","presentationStyle","voiceLanguage","voiceProfile","speakingStyle","script","talkingPoints","instructions","referenceImageAssetId","referenceVideoAssetId","voiceSampleAssetId","referenceImageUrl","referenceVideoUrl","voiceSampleUrl","status","scope","approvedBy","approvedAt","cancelledAt","startedAt","endedAt","configVersion","configSnapshot","rendererStatus","createdBy","updatedBy","createdAt","updatedAt"] }


// Join metadata: { kind, model, from, to } per relation field.
const RELATIONS = {
  "user": {
    "sessions": {
      "kind": "many",
      "model": "session",
      "from": "id",
      "to": "userId"
    },
    "profile": {
      "kind": "one",
      "model": "profile",
      "from": "id",
      "to": "userId"
    },
    "ownedGroups": {
      "kind": "many",
      "model": "group",
      "from": "id",
      "to": "ownerId"
    },
    "groupMemberships": {
      "kind": "many",
      "model": "groupMember",
      "from": "id",
      "to": "userId"
    },
    "sentMessages": {
      "kind": "many",
      "model": "message",
      "from": "id",
      "to": "senderId"
    },
    "receivedMessages": {
      "kind": "many",
      "model": "message",
      "from": "id",
      "to": "receiverId"
    },
    "callsMade": {
      "kind": "many",
      "model": "call",
      "from": "id",
      "to": "callerId"
    },
    "callsReceived": {
      "kind": "many",
      "model": "call",
      "from": "id",
      "to": "receiverId"
    },
    "files": {
      "kind": "many",
      "model": "file",
      "from": "id",
      "to": "ownerId"
    },
    "notifications": {
      "kind": "many",
      "model": "notification",
      "from": "id",
      "to": "userId"
    },
    "messageStars": {
      "kind": "many",
      "model": "messageStar",
      "from": "id",
      "to": "userId"
    },
    "messageDrafts": {
      "kind": "many",
      "model": "messageDraft",
      "from": "id",
      "to": "userId"
    },
    "messageReminders": {
      "kind": "many",
      "model": "messageReminder",
      "from": "id",
      "to": "userId"
    },
    "friendRequestsSent": {
      "kind": "many",
      "model": "friendRequest",
      "from": "id",
      "to": "fromId"
    },
    "friendRequestsRecv": {
      "kind": "many",
      "model": "friendRequest",
      "from": "id",
      "to": "toId"
    },
    "friendshipRequests": {
      "kind": "many",
      "model": "friendship",
      "from": "id",
      "to": "requesterId"
    },
    "friendshipReceived": {
      "kind": "many",
      "model": "friendship",
      "from": "id",
      "to": "receiverId"
    },
    "conversationMemberships": {
      "kind": "many",
      "model": "conversationMember",
      "from": "id",
      "to": "userId"
    },
    "blocksIssued": {
      "kind": "many",
      "model": "block",
      "from": "id",
      "to": "fromId"
    },
    "blocksRecv": {
      "kind": "many",
      "model": "block",
      "from": "id",
      "to": "toId"
    },
    "reportsIssued": {
      "kind": "many",
      "model": "report",
      "from": "id",
      "to": "fromId"
    },
    "reportsRecv": {
      "kind": "many",
      "model": "report",
      "from": "id",
      "to": "toId"
    },
    "chatPreferences": {
      "kind": "many",
      "model": "chatPreference",
      "from": "id",
      "to": "userId"
    },
    "auditLogs": {
      "kind": "many",
      "model": "auditLog",
      "from": "id",
      "to": "userId"
    },
    "pushSubscriptions": {
      "kind": "many",
      "model": "pushSubscription",
      "from": "id",
      "to": "userId"
    },
    "fileAccessGrants": {
      "kind": "many",
      "model": "fileAccess",
      "from": "id",
      "to": "userId"
    },
    "messageReactions": {
      "kind": "many",
      "model": "messageReaction",
      "from": "id",
      "to": "userId"
    },
    "stories": {
      "kind": "many",
      "model": "story",
      "from": "id",
      "to": "userId"
    },
    "storyViews": {
      "kind": "many",
      "model": "storyView",
      "from": "id",
      "to": "userId"
    },
    "storyReplies": {
      "kind": "many",
      "model": "storyReply",
      "from": "id",
      "to": "userId"
    },
    "storyReactions": {
      "kind": "many",
      "model": "storyReaction",
      "from": "id",
      "to": "userId"
    },
    "broadcastLists": {
      "kind": "many",
      "model": "broadcastList",
      "from": "id",
      "to": "ownerId"
    },
    "broadcastMemberships": {
      "kind": "many",
      "model": "broadcastMember",
      "from": "id",
      "to": "recipientId"
    },
    "posts": {
      "kind": "many",
      "model": "post",
      "from": "id",
      "to": "authorId"
    },
    "postComments": {
      "kind": "many",
      "model": "postComment",
      "from": "id",
      "to": "authorId"
    },
    "postReactions": {
      "kind": "many",
      "model": "postReaction",
      "from": "id",
      "to": "userId"
    },
    "pollVotes": {
      "kind": "many",
      "model": "pollVote",
      "from": "id",
      "to": "userId"
    }
  },
  "verificationToken": {},
  "session": {
    "user": {
      "kind": "one",
      "model": "user",
      "from": "userId",
      "to": "id"
    }
  },
  "profile": {
    "user": {
      "kind": "one",
      "model": "user",
      "from": "userId",
      "to": "id"
    }
  },
  "friendship": {
    "requester": {
      "kind": "one",
      "model": "user",
      "from": "requesterId",
      "to": "id"
    },
    "receiver": {
      "kind": "one",
      "model": "user",
      "from": "receiverId",
      "to": "id"
    }
  },
  "message": {
    "sender": {
      "kind": "one",
      "model": "user",
      "from": "senderId",
      "to": "id"
    },
    "receiver": {
      "kind": "one",
      "model": "user",
      "from": "receiverId",
      "to": "id"
    },
    "replyTo": {
      "kind": "one",
      "model": "message",
      "from": "replyToId",
      "to": "id"
    },
    "replies": {
      "kind": "many",
      "model": "message",
      "from": "id",
      "to": "replyToId"
    },
    "group": {
      "kind": "one",
      "model": "group",
      "from": "groupId",
      "to": "id"
    },
    "conversation": {
      "kind": "one",
      "model": "conversation",
      "from": "conversationId",
      "to": "id"
    },
    "stars": {
      "kind": "many",
      "model": "messageStar",
      "from": "id",
      "to": "messageId"
    },
    "reminders": {
      "kind": "many",
      "model": "messageReminder",
      "from": "id",
      "to": "messageId"
    },
    "reactions": {
      "kind": "many",
      "model": "messageReaction",
      "from": "id",
      "to": "messageId"
    },
    "attachments": {
      "kind": "many",
      "model": "attachment",
      "from": "id",
      "to": "messageId"
    },
    "fileAccess": {
      "kind": "many",
      "model": "fileAccess",
      "from": "id",
      "to": "messageId"
    }
  },
  "messageStar": {
    "user": {
      "kind": "one",
      "model": "user",
      "from": "userId",
      "to": "id"
    },
    "message": {
      "kind": "one",
      "model": "message",
      "from": "messageId",
      "to": "id"
    }
  },
  "messageReaction": {
    "message": {
      "kind": "one",
      "model": "message",
      "from": "messageId",
      "to": "id"
    },
    "user": {
      "kind": "one",
      "model": "user",
      "from": "userId",
      "to": "id"
    }
  },
  "messageDraft": {
    "user": {
      "kind": "one",
      "model": "user",
      "from": "userId",
      "to": "id"
    }
  },
  "messageReminder": {
    "user": {
      "kind": "one",
      "model": "user",
      "from": "userId",
      "to": "id"
    },
    "message": {
      "kind": "one",
      "model": "message",
      "from": "messageId",
      "to": "id"
    }
  },
  "chatPreference": {
    "user": {
      "kind": "one",
      "model": "user",
      "from": "userId",
      "to": "id"
    }
  },
  "group": {
    "owner": {
      "kind": "one",
      "model": "user",
      "from": "ownerId",
      "to": "id"
    },
    "members": {
      "kind": "many",
      "model": "groupMember",
      "from": "id",
      "to": "groupId"
    },
    "messages": {
      "kind": "many",
      "model": "message",
      "from": "id",
      "to": "groupId"
    }
  },
  "groupMember": {
    "group": {
      "kind": "one",
      "model": "group",
      "from": "groupId",
      "to": "id"
    },
    "user": {
      "kind": "one",
      "model": "user",
      "from": "userId",
      "to": "id"
    }
  },
  "call": {
    "caller": {
      "kind": "one",
      "model": "user",
      "from": "callerId",
      "to": "id"
    },
    "receiver": {
      "kind": "one",
      "model": "user",
      "from": "receiverId",
      "to": "id"
    }
  },
  "file": {
    "owner": {
      "kind": "one",
      "model": "user",
      "from": "ownerId",
      "to": "id"
    }
  },
  "notification": {
    "user": {
      "kind": "one",
      "model": "user",
      "from": "userId",
      "to": "id"
    }
  },
  "story": {
    "user": {
      "kind": "one",
      "model": "user",
      "from": "userId",
      "to": "id"
    },
    "views": {
      "kind": "many",
      "model": "storyView",
      "from": "id",
      "to": "storyId"
    },
    "replies": {
      "kind": "many",
      "model": "storyReply",
      "from": "id",
      "to": "storyId"
    },
    "reactions": {
      "kind": "many",
      "model": "storyReaction",
      "from": "id",
      "to": "storyId"
    }
  },
  "storyView": {
    "story": {
      "kind": "one",
      "model": "story",
      "from": "storyId",
      "to": "id"
    },
    "user": {
      "kind": "one",
      "model": "user",
      "from": "userId",
      "to": "id"
    }
  },
  "storyReply": {
    "story": {
      "kind": "one",
      "model": "story",
      "from": "storyId",
      "to": "id"
    },
    "user": {
      "kind": "one",
      "model": "user",
      "from": "userId",
      "to": "id"
    }
  },
  "storyReaction": {
    "story": {
      "kind": "one",
      "model": "story",
      "from": "storyId",
      "to": "id"
    },
    "user": {
      "kind": "one",
      "model": "user",
      "from": "userId",
      "to": "id"
    }
  },
  "broadcastList": {
    "owner": {
      "kind": "one",
      "model": "user",
      "from": "ownerId",
      "to": "id"
    },
    "members": {
      "kind": "many",
      "model": "broadcastMember",
      "from": "id",
      "to": "broadcastListId"
    }
  },
  "broadcastMember": {
    "broadcastList": {
      "kind": "one",
      "model": "broadcastList",
      "from": "broadcastListId",
      "to": "id"
    },
    "recipient": {
      "kind": "one",
      "model": "user",
      "from": "recipientId",
      "to": "id"
    }
  },
  "pushSubscription": {
    "user": {
      "kind": "one",
      "model": "user",
      "from": "userId",
      "to": "id"
    }
  },
  "auditLog": {
    "user": {
      "kind": "one",
      "model": "user",
      "from": "userId",
      "to": "id"
    }
  },
  "post": {
    "author": {
      "kind": "one",
      "model": "user",
      "from": "authorId",
      "to": "id"
    },
    "comments": {
      "kind": "many",
      "model": "postComment",
      "from": "id",
      "to": "postId"
    },
    "reactions": {
      "kind": "many",
      "model": "postReaction",
      "from": "id",
      "to": "postId"
    }
  },
  "postComment": {
    "post": {
      "kind": "one",
      "model": "post",
      "from": "postId",
      "to": "id"
    },
    "author": {
      "kind": "one",
      "model": "user",
      "from": "authorId",
      "to": "id"
    }
  },
  "postReaction": {
    "post": {
      "kind": "one",
      "model": "post",
      "from": "postId",
      "to": "id"
    },
    "user": {
      "kind": "one",
      "model": "user",
      "from": "userId",
      "to": "id"
    }
  },
  "poll": {
    "votes": {
      "kind": "many",
      "model": "pollVote",
      "from": "id",
      "to": "pollId"
    }
  },
  "pollVote": {
    "poll": {
      "kind": "one",
      "model": "poll",
      "from": "pollId",
      "to": "id"
    },
    "user": {
      "kind": "one",
      "model": "user",
      "from": "userId",
      "to": "id"
    }
  },
  "conversation": {
    "members": {
      "kind": "many",
      "model": "conversationMember",
      "from": "id",
      "to": "conversationId"
    },
    "messages": {
      "kind": "many",
      "model": "message",
      "from": "id",
      "to": "conversationId"
    }
  },
  "conversationMember": {
    "conversation": {
      "kind": "one",
      "model": "conversation",
      "from": "conversationId",
      "to": "id"
    },
    "user": {
      "kind": "one",
      "model": "user",
      "from": "userId",
      "to": "id"
    }
  },
  "block": {
    "from": {
      "kind": "one",
      "model": "user",
      "from": "fromId",
      "to": "id"
    },
    "to": {
      "kind": "one",
      "model": "user",
      "from": "toId",
      "to": "id"
    }
  },
  "report": {
    "from": {
      "kind": "one",
      "model": "user",
      "from": "fromId",
      "to": "id"
    },
    "to": {
      "kind": "one",
      "model": "user",
      "from": "toId",
      "to": "id"
    }
  },
  "attachment": {
    "message": {
      "kind": "one",
      "model": "message",
      "from": "messageId",
      "to": "id"
    }
  },
  "fileAccess": {
    "user": {
      "kind": "one",
      "model": "user",
      "from": "userId",
      "to": "id"
    },
    "message": {
      "kind": "one",
      "model": "message",
      "from": "messageId",
      "to": "id"
    }
  },
  "friendRequest": {
    "from": {
      "kind": "one",
      "model": "user",
      "from": "fromId",
      "to": "id"
    },
    "to": {
      "kind": "one",
      "model": "user",
      "from": "toId",
      "to": "id"
    }
  },
  "jaraConfig": {},
  "jaraProposal": {
    "auditLogs": {
      "kind": "many",
      "model": "jaraAuditLog",
      "from": "id",
      "to": "proposalId"
    }
  },
  "jaraAuditLog": {
    "proposal": {
      "kind": "one",
      "model": "jaraProposal",
      "from": "proposalId",
      "to": "id"
    }
  },
  "jaraMemory": {},
  "jaraGroupConsent": {},
  "jaraAppearanceProfile": {
    "callAssignments": {
      "kind": "many",
      "model": "jaraCallPresentation",
      "from": "id",
      "to": "profileId"
    }
  },
  "jaraCallPresentation": {
    "profile": {
      "kind": "one",
      "model": "jaraAppearanceProfile",
      "from": "profileId",
      "to": "id"
    }
  },
  "jaraSmsConfig": {},
  "jaraSmsContact": {
    "messages": {
      "kind": "many",
      "model": "jaraSmsMessage",
      "from": "id",
      "to": "contactId"
    }
  },
  "jaraSmsMessage": {
    "contact": {
      "kind": "one",
      "model": "jaraSmsContact",
      "from": "contactId",
      "to": "id"
    }
  },
  "jaraDonorContribution": {},
  "jaraConsentRecord": {},
  "jaraMeetingIntegration": {},
  "jaraKnowledgeSource": {},
  "jaraAsset": {},
  "jaraMeetingProfile": {},
}

for (const [key, rels] of Object.entries(RELATIONS)) {
  if (MODELS[key]) MODELS[key].relations = rels
}

module.exports = { MODELS, EXPECTED_COLUMNS, RELATIONS, cuid }
