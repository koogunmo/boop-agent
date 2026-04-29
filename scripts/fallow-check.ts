const result = Bun.spawnSync(["fallow", "--fail-on-regression", "--format", "json"], {
  stderr: "ignore",
});

const { check } = JSON.parse(result.stdout.toString()) as {
  check: {
    regression: { status: string; delta: number; baseline_total: number };
  };
};

const { status, delta, baseline_total } = check.regression;
console.log(`fallow: ${status} (delta: ${delta}, baseline: ${baseline_total})`);
process.exit(status === "pass" ? 0 : 1);
