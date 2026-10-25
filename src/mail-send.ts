// Outbound mail for the sandbox: the one place this repository is allowed to *send*.
//
// The safety property is deliberately about the transport, not the address. A sandbox SMTP host is
// loopback, so nothing can leave the machine no matter what the fictional `To:` says — which is
// what lets the demo mail use realistic-looking customer addresses without risk. A remote SMTP
// host is refused unless the operator explicitly overrides it, because that is the point where a
// demo becomes a way to email strangers.
import { createTransport } from 'nodemailer';

export type OutgoingReply = { to: string; subject: string; text: string };
export type SendReply = (mail: OutgoingReply) => Promise<{ messageId: string }>;

const LOOPBACK = new Set(['127.0.0.1', 'localhost', '[::1]', 'host.docker.internal']);

export function smtpSender(options: {
  endpoint?: string;
  from?: string;
  allowRemote?: boolean;
} = {}): SendReply {
  const endpoint = options.endpoint ?? process.env.SANDBOX_CUSTOMER_SMTP ?? '127.0.0.1:1025';
  const [host, port] = endpoint.split(':');
  const from = options.from ?? process.env.SANDBOX_SALES_ADDRESS ?? 'sales@example.invalid';
  const allowRemote = options.allowRemote ?? process.env.SANDBOX_ALLOW_REMOTE === '1';

  if (!LOOPBACK.has(host) && !allowRemote) {
    throw Error(
      `SANDBOX_SMTP_NOT_LOOPBACK: "${host}" is not a loopback host. Replies are only sent to a local ` +
      'sandbox mailbox. Set SANDBOX_ALLOW_REMOTE=1 only if you really mean to deliver real mail.',
    );
  }

  const transport = createTransport({ host, port: Number(port), secure: false, ignoreTLS: true });
  return async mail => {
    const info = await transport.sendMail({
      from, to: mail.to, subject: mail.subject, text: mail.text,
    });
    return { messageId: info.messageId };
  };
}
