// Sanity-check before build: detecteaza wipe-uri masive in working tree.
// Cazul tinta — folderul `backend/` sau `frontend/` golite de pe disc cu git
// HEAD intact (incident 2026-05-02). Build-ul ar continua peste tree corupt
// si ar produce un bundle stricat fara warning.
//
// Threshold: > 50 deletions raw in working tree (nu staged) = halt + sugereaza
// remediu. < 50 = pass tacut.

import { execFileSync } from "node:child_process";

const THRESHOLD = 50;

let porcelain;
try {
  porcelain = execFileSync("git", ["status", "--porcelain"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  });
} catch {
  // Nu suntem intr-un repo git — skip silent (build poate veni dintr-un tarball)
  process.exit(0);
}

const lines = porcelain.split("\n").filter(Boolean);
// Format porcelain v1: "XY path" unde X=index, Y=worktree.
// " D path" = deleted in worktree dar nu staged.
// "D  path" = deleted in index (staged) — la fel de periculos daca cineva
// face `git add -A` peste un wipe de antivirus inainte de build.
// "DD path" = deleted in ambele (rar, dar inclus din precautie).
const worktreeDeletions = lines.filter((l) => l.startsWith(" D ") || l.startsWith("D  ") || l.startsWith("DD "));

if (worktreeDeletions.length <= THRESHOLD) {
  process.exit(0);
}

const sample = worktreeDeletions
  .slice(0, 5)
  .map((l) => `    ${l.slice(3)}`)
  .join("\n");

console.error("");
console.error(
  `[check-worktree] HALT: ${worktreeDeletions.length} fisiere deletate din working tree (threshold ${THRESHOLD}).`
);
console.error(
  "[check-worktree] Foarte probabil un wipe extern (antivirus / sync cloud / IDE bulk action), nu o operatie git."
);
console.error("");
console.error("Mostra:");
console.error(sample);
if (worktreeDeletions.length > 5) {
  console.error(`    ... +${worktreeDeletions.length - 5} altele`);
}
console.error("");
console.error("Remediu — restore din HEAD fara sa pierzi staged/modified files:");
console.error("    git restore --source=HEAD --worktree -- <folder>");
console.error("");
console.error("Daca deletion-urile sunt intentionate, foloseste `git rm` si commit-eaza inainte de build.");
console.error("");
process.exit(1);
