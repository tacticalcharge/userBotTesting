import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const css = fs.readFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), "message.css"),
  "utf8"
);

function escapeHtml(value = "") {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function renderAttachments(message) {
  return [...message.attachments.values()]
    .map((attachment) => {
      const url = escapeHtml(attachment.url);
      const isImage = attachment.contentType?.startsWith("image/");

      if (isImage) {
        return `<img class="attachment" src="${url}" alt="Attached image">`;
      }

      return `<a class="attachment-link" href="${url}">${escapeHtml(attachment.name ?? "Attachment")}</a>`;
    })
    .join("");
}

export function renderMessageHtml(message) {
  const authorName = message.author.displayName ?? message.author.username;
  const avatarUrl = escapeHtml(message.author.displayAvatarURL({ extension: "png", size: 128 }));
  const messageUrl = escapeHtml(message.url);
  const timestamp = escapeHtml(message.createdAt.toISOString());
  const displayTimestamp = escapeHtml(message.createdAt.toLocaleString());
  const content = escapeHtml(message.content || "[No text content]");

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Discord Message Proof</title>
  <style>${css}</style>
</head>
<body>
  <main class="proof-card">
    <p class="proof-label">Moderation proof</p>
    <article class="message">
      <img class="avatar" src="${avatarUrl}" alt="">
      <div class="message-body">
        <header class="message-header">
          <span class="author">${escapeHtml(authorName)}</span>
          <time class="timestamp" datetime="${timestamp}">${displayTimestamp}</time>
        </header>
        <p class="content">${content}</p>
        ${renderAttachments(message)}
      </div>
    </article>
    <p class="source">Original message: <a href="${messageUrl}">${messageUrl}</a></p>
  </main>
</body>
</html>`;
}
