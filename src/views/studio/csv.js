// CSV export of the circle (studio, Members tab). Pure helpers plus the one function that touches the document.

// A spreadsheet runs a cell that starts with = + - @ (or a tab / carriage return) as a formula, and a member can choose any
// display name. Such cells get a leading apostrophe, which spreadsheets show as plain text. Every cell is quoted.
export function csvCell(value) {
  let text = String(value ?? '').replace(/\r\n|\r|\n/g, ' ');
  if (/^[=+\-@]/.test(text.trimStart()) || /^\t/.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
}

export const csvRow = cells => cells.map(csvCell).join(',');

const day = value => {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '' : date.toISOString().slice(0, 10);
};

// members: what api.circleMembers() returns ([{member, tier, joinedAt}]). Rows end with CRLF, as RFC 4180 asks.
export function membersCsv(members = []) {
  const rows = [csvRow(['Name', 'Tier', 'Joined'])];
  for (const entry of members) rows.push(csvRow([entry.member?.name, entry.tier?.name, day(entry.joinedAt)]));
  return `${rows.join('\r\n')}\r\n`;
}

export const csvFilename = (slug, now = new Date()) => `refluenz-circle-${String(slug || 'atelier').replace(/[^a-z0-9-]/gi, '').slice(0, 40) || 'atelier'}-${now.toISOString().slice(0, 10)}.csv`;

// Hands the text to the browser as a file. The byte order mark lets Excel read accents correctly.
export function downloadCsv(filename, text) {
  const blob = new Blob(['﻿', text], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.hidden = true;
  document.body.append(link);
  link.click();
  link.remove();
  const timer = setTimeout(() => URL.revokeObjectURL(url), 4000);
  timer.unref?.();
}
