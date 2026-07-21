export function getInstallLayout(options = {}) {
  const platform = options.platform ?? process.platform;
  const env = options.env ?? process.env;

  if (platform === "win32") {
    const localAppData = env.LOCALAPPDATA ?? "%LOCALAPPDATA%";
    const dataRoot = `${localAppData}\\AgentComputerUse`;
    return {
      platform,
      dataRoot,
      artifactRoot: `${dataRoot}\\artifacts`,
      modelRoot: `${dataRoot}\\cache\\models`,
      logRoot: `${dataRoot}\\logs`,
      traceRoot: `${dataRoot}\\traces`,
      sessionRoot: `${dataRoot}\\sessions`,
      cacheRoot: `${dataRoot}\\cache`,
      driverRoot: `${dataRoot}\\cache\\cua-driver`,
      overlayRoot: `${dataRoot}\\cache\\overlay`,
      runtimeRoot: `${dataRoot}\\cache\\runtime`,
      authoritativeProgramState: false,
    };
  }

  const home = env.XDG_DATA_HOME ?? (env.HOME ? `${env.HOME}/.local/share` : "~/.local/share");
  const dataRoot = `${home}/agent-computer-use`;
  return {
    platform,
    dataRoot,
    artifactRoot: `${dataRoot}/artifacts`,
    modelRoot: `${dataRoot}/models`,
    logRoot: `${dataRoot}/logs`,
    traceRoot: `${dataRoot}/traces`,
    sessionRoot: `${dataRoot}/sessions`,
    cacheRoot: `${dataRoot}/cache`,
    driverRoot: `${dataRoot}/cache/cua-driver`,
    overlayRoot: `${dataRoot}/cache/overlay`,
    runtimeRoot: `${dataRoot}/cache/runtime`,
    authoritativeProgramState: false,
  };
}
