/**
 * 사람 행동 시뮬레이션 유틸리티 v3
 *
 * CDP 모드에서는 진짜 Chrome을 사용하므로
 * fingerprint 위장이 불필요 — 행동 패턴만 사람처럼 만들면 됨
 */

// ─── 딜레이 유틸 ──────────────────────────────────────────────────

/** 가우시안 분포 랜덤 (사람의 반응 시간에 더 가까움) */
function gaussianRandom(mean, stdDev) {
  let u = 0, v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  const z = Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
  return Math.max(0, Math.round(mean + z * stdDev));
}

/** 사람처럼 불규칙한 대기 */
export function randomDelay(minMs, maxMs) {
  const mean = (minMs + maxMs) / 2;
  const stdDev = (maxMs - minMs) / 4;
  const ms = Math.min(maxMs * 1.2, Math.max(minMs * 0.8, gaussianRandom(mean, stdDev)));
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ─── 사람 행동 시뮬레이션 ─────────────────────────────────────────

/** 베지어 곡선 마우스 이동 (직선이 아닌 자연스러운 곡선) */
export async function humanMouseMove(page) {
  const moves = 2 + Math.floor(Math.random() * 3);
  let x = 200 + Math.random() * 800;
  let y = 200 + Math.random() * 400;

  for (let i = 0; i < moves; i++) {
    const targetX = 100 + Math.random() * 1100;
    const targetY = 100 + Math.random() * 600;
    const steps = 10 + Math.floor(Math.random() * 15);

    const cpX = (x + targetX) / 2 + (Math.random() - 0.5) * 200;
    const cpY = (y + targetY) / 2 + (Math.random() - 0.5) * 200;

    for (let t = 0; t <= 1; t += 1 / steps) {
      const px = (1 - t) * (1 - t) * x + 2 * (1 - t) * t * cpX + t * t * targetX;
      const py = (1 - t) * (1 - t) * y + 2 * (1 - t) * t * cpY + t * t * targetY;
      await page.mouse.move(px, py);
      await new Promise((r) => setTimeout(r, 5 + Math.random() * 15));
    }

    x = targetX;
    y = targetY;
    await randomDelay(100, 400);
  }
}

/** 사람처럼 스크롤 (속도 변화 + 중간 멈춤) */
export async function humanScroll(page) {
  const scrolls = 3 + Math.floor(Math.random() * 4);

  for (let i = 0; i < scrolls; i++) {
    const distance = 200 + Math.floor(Math.random() * 600);
    const chunks = 5 + Math.floor(Math.random() * 5);
    const chunkSize = distance / chunks;

    for (let j = 0; j < chunks; j++) {
      await page.mouse.wheel(0, chunkSize + (Math.random() - 0.5) * 20);
      await new Promise((r) => setTimeout(r, 30 + Math.random() * 60));
    }

    if (Math.random() > 0.4) {
      await randomDelay(800, 2500);
    } else {
      await randomDelay(200, 500);
    }
  }
}

/** 페이지 내 랜덤 요소에 마우스 hover */
export async function randomHover(page) {
  try {
    const links = await page.$$("a, img, button");
    if (links.length === 0) return;

    const count = 1 + Math.floor(Math.random() * 3);
    for (let i = 0; i < count; i++) {
      const el = links[Math.floor(Math.random() * links.length)];
      const box = await el.boundingBox();
      if (box) {
        await page.mouse.move(
          box.x + box.width * Math.random(),
          box.y + box.height * Math.random(),
          { steps: 5 + Math.floor(Math.random() * 10) }
        );
        await randomDelay(200, 800);
      }
    }
  } catch {
    // 무시
  }
}
