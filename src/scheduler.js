/**
 * 하루 1회 자동 크롤링 스케줄러
 *
 * 사용법: node src/scheduler.js [--time 03:00]
 *
 * 주의: Chrome이 디버그 모드(포트 9222)로 실행 중이어야 합니다!
 *       start-chrome.bat으로 Chrome을 먼저 시작해주세요.
 *
 * 지정 시간에 크롤러를 실행하고, 다음 날까지 대기합니다.
 * 기본 실행 시간: 새벽 3시
 */
import { execFile } from "child_process";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));

function parseArgs() {
  const args = process.argv.slice(2);
  let time = "03:00";
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--time" && args[i + 1]) {
      time = args[++i];
    }
  }
  return { time };
}

/** 다음 실행 시각까지 남은 밀리초 계산 */
function msUntilNext(timeStr) {
  const [hours, minutes] = timeStr.split(":").map(Number);
  const now = new Date();
  const next = new Date();
  next.setHours(hours, minutes, 0, 0);

  // 이미 지난 시간이면 내일로 설정
  if (next <= now) {
    next.setDate(next.getDate() + 1);
  }

  return next - now;
}

/** 크롤러 실행 */
function runCrawler() {
  return new Promise((resolve, reject) => {
    console.log(`\n[${new Date().toLocaleString("ko-KR")}] 크롤러 실행 시작`);

    const crawlScript = join(__dirname, "crawl.js");
    const child = execFile("node", [crawlScript], { cwd: join(__dirname, "..") }, (err) => {
      if (err) {
        console.error(`크롤러 오류: ${err.message}`);
        reject(err);
      } else {
        console.log(`[${new Date().toLocaleString("ko-KR")}] 크롤러 실행 완료`);
        resolve();
      }
    });

    child.stdout?.pipe(process.stdout);
    child.stderr?.pipe(process.stderr);
  });
}

/** 스케줄러 메인 루프 */
async function main() {
  const { time } = parseArgs();

  console.log("=".repeat(50));
  console.log("쿠팡 크롤러 스케줄러");
  console.log(`실행 시간: 매일 ${time}`);
  console.log("종료: Ctrl+C");
  console.log("=".repeat(50));

  while (true) {
    const waitMs = msUntilNext(time);
    const waitHours = (waitMs / 1000 / 60 / 60).toFixed(1);
    console.log(`\n다음 실행까지 ${waitHours}시간 대기...`);

    await new Promise((resolve) => setTimeout(resolve, waitMs));

    try {
      await runCrawler();
    } catch {
      console.error("크롤링 실패, 다음 스케줄에 재시도합니다.");
    }
  }
}

main();
