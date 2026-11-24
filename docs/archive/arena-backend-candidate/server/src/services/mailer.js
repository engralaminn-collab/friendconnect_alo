import nodemailer from 'nodemailer';

export function createMailer(smtp, appOrigin) {
  if (!smtp.host || !smtp.port || !smtp.from) return null;
  const transport = nodemailer.createTransport({
    host: smtp.host,
    port: smtp.port,
    secure: smtp.secure,
    auth: smtp.user && smtp.password ? { user: smtp.user, pass: smtp.password } : undefined,
    disableFileAccess: true,
    disableUrlAccess: true,
  });

  const send = (message) => transport.sendMail({
    from: smtp.from,
    ...message,
    headers: { 'X-Auto-Response-Suppress': 'All' },
  });

  return Object.freeze({
    async sendInvite({ to, token, expiresAt }) {
      const inviteUrl = `${appOrigin}/self-hosted/accept-invite#token=${encodeURIComponent(token)}`;
      await send({
        to,
        subject: 'Your FriendConnect invitation',
        text: `You were invited to join FriendConnect. Open ${inviteUrl} to accept. This invitation expires at ${expiresAt.toISOString()} and can only be used once. If you did not expect this, ignore this message.`,
      });
    },
    async sendVerification({ to, token }) {
      const verifyUrl = `${appOrigin}/self-hosted/verify-email#token=${encodeURIComponent(token)}`;
      await send({
        to,
        subject: 'Verify your FriendConnect email',
        text: `Verify your email for FriendConnect: ${verifyUrl}\n\nThis link expires in 24 hours. If you did not create an account, ignore this message.`,
      });
    },
    async sendPasswordReset({ to, token }) {
      const resetUrl = `${appOrigin}/self-hosted/reset-password#token=${encodeURIComponent(token)}`;
      await send({
        to,
        subject: 'Reset your FriendConnect password',
        text: `Reset your FriendConnect password: ${resetUrl}\n\nThis link expires in 30 minutes. If you did not request this, ignore this message.`,
      });
    },
  });
}
