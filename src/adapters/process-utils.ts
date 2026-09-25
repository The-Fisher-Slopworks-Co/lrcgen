export async function commandExists(cmd: string): Promise<boolean> {
  try {
    const proc = Bun.spawn(["which", cmd], { stdout: "ignore", stderr: "ignore" });
    await proc.exited;
    return proc.exitCode === 0;
  } catch {
    return false;
  }
}
