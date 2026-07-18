process.stderr.write(
  "release.source_publish_blocked: agent-computer-use-mcp is an outgoing npm identity; publish is blocked from the source workspace\n",
);
process.exitCode = 1;
