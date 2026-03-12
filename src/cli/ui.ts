const isColorSupported = process.stdout.isTTY !== false && !process.env.NO_COLOR;

const esc = (code: string) => (isColorSupported ? `\x1b[${code}m` : "");

export const c = {
  reset: esc("0"),
  bold: esc("1"),
  dim: esc("2"),
  red: esc("31"),
  green: esc("32"),
  yellow: esc("33"),
  blue: esc("34"),
  magenta: esc("35"),
  cyan: esc("36"),
  white: esc("37"),
  orangeRed: esc("38;5;202"),
  orange: esc("38;5;208"),
  coral: esc("38;5;209"),
};

// prettier-ignore
export const LOGO = [
  `      ..                                                                ..`,
  `    .==-:                                                              .-==:`,
  `   :+++-.  :-.              :--==-.          .-==--:.             .--   -+++-`,
  `  :++++-:  -++-         .-+++======++++++++++======+++-:         :=*=  .-=+++:`,
  `  -*+++=-..=+++-       -+++=++++**+++++++++++++*+++++++*=.      :+++=:.-=+++*=`,
  `  =*++++==---=+-      -*++++++++++++++++++++++++++++++++*=      :+=----=++++*=.`,
  `  :*+++++++=---:     -+++++++++++++++++++++++++++++++++++*-     .---=+++++++*-`,
  `   -**+++++++=:     :+++++++++++++++++++++++++++++++++++++*-     :-++++++++*=.`,
  `    :++++++++-.     =++++++++++++==++++++++++==++++++++++++--.   .-++++++++-`,
  `      :-=+==---    :++++++++++=:::+=++++++++=+-::-+++++++=---.   :--==+=-:`,
  `         -++++-:.  -+++++++++=.:.-#-:++++++-:#=.:.-++++=-----. .:-=+++=.`,
  `         .-++=--=-:=+++++++++=..:...-++++++-...:..=*+=----=++:-==-=++=.`,
  `            .-=+++:+++++++++++=::::-++++++++=:::-=+=----=++++-=++=-..`,
  `              .:---+++++++++++++++++++***+++*+++==----=++++++---:.`,
  `                  :=+++========++**########**=--:--=+++++++++-`,
  `                  ---=--=+++=====++=*##**+=----=++++===+++++=:`,
  `                   :-:-=========+=-::=------=++++=--==+++==-:`,
  `                     ::-=--=-====::-------=====-:-=++==---:.`,
  `                   .-:--::-=:---::--:===========----::---===.`,
  `                  .-=:===-=------:--.        .:=====: .-++++-.`,
  `                  .==---==-=====:--:           -====-.  -====:`,
  `                   -+++-...:----:::.           :===+:   -+++=.`,
  `                   .-++=.   :+++-.             -+++-   .=++=.`,
  `                     :=+-    .=++:            :++=:    :++-.`,
  `                       :.      .::            .:.      .:.`,
].map((line) => `${c.orange}${line}${c.reset}`).join("\n");

export function banner(subtitle?: string): void {
  console.log();
  console.log(LOGO);
  console.log();
  console.log(`  ${c.bold}${c.orange}disclaw${c.reset}${subtitle ? `  ${c.dim}${subtitle}${c.reset}` : ""}`);
  console.log();
}

export function step(num: number, total: number, title: string): void {
  console.log(`${c.cyan}${c.bold}[${num}/${total}]${c.reset} ${c.bold}${title}${c.reset}`);
}

export function hint(text: string): void {
  console.log(`  ${c.dim}${text}${c.reset}`);
}

export function success(text: string): void {
  console.log(`  ${c.green}✓${c.reset} ${text}`);
}

export function fail(text: string): void {
  console.log(`  ${c.red}✗${c.reset} ${text}`);
}

export function warn(text: string): void {
  console.log(`  ${c.yellow}⚠${c.reset} ${text}`);
}

export function done(text: string): void {
  console.log(`\n${c.green}${c.bold}✅ ${text}${c.reset}`);
}

export function next(text: string): void {
  console.log(`\n${c.cyan}→${c.reset} Next: ${c.bold}${text}${c.reset}`);
}

export class Spinner {
  private frames = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
  private i = 0;
  private timer: ReturnType<typeof setInterval> | null = null;
  private text: string;

  constructor(text: string) {
    this.text = text;
  }

  start(): void {
    if (!isColorSupported) {
      process.stdout.write(`  ${this.text}...`);
      return;
    }
    this.timer = setInterval(() => {
      process.stdout.write(`\r  ${c.cyan}${this.frames[this.i]}${c.reset} ${this.text}`);
      this.i = (this.i + 1) % this.frames.length;
    }, 80);
  }

  stop(result: string): void {
    if (this.timer) clearInterval(this.timer);
    if (isColorSupported) process.stdout.write("\r\x1b[K");
    console.log(`  ${result}`);
  }
}
