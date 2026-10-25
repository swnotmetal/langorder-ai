// Reads the sandbox customer mailbox: what the customer would have received.
//
// Mailpit exposes a JSON API, so this is the verification step for "sales approved, the reply went
// out" without needing an IMAP client. Point it elsewhere with SANDBOX_INBOX=http://host:port.
const base = process.env.SANDBOX_INBOX ?? 'http://127.0.0.1:8025';

type Message = {
  ID: string;
  Subject: string;
  To: { Address: string }[];
  From: { Address: string };
  Created: string;
  Snippet: string;
};

try {
  const res = await fetch(new URL('/api/v1/messages?limit=20', base), { signal: AbortSignal.timeout(4000) });
  if (!res.ok) throw Error(`HTTP ${res.status}`);
  const body = (await res.json()) as { total: number; messages: Message[] };
  if (!body.total) {
    process.stdout.write(`Customer mailbox at ${base} is empty.\n`);
  } else {
    process.stdout.write(`${body.total} message(s) in the customer mailbox (${base}):\n\n`);
    for (const message of body.messages) {
      process.stdout.write(
        `${message.Created}  ${message.From.Address} -> ${message.To.map(t => t.Address).join(', ')}\n` +
        `  ${message.Subject}\n  ${message.Snippet.replace(/\s+/g, ' ').slice(0, 120)}\n\n`,
      );
    }
  }
} catch (error) {
  process.stdout.write(
    `Cannot read ${base}: ${(error as Error).message}\n` +
    'Start the sandbox customer inbox with: .\\infra\\start-mailpit.ps1\n',
  );
  process.exitCode = 1;
}
