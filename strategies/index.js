const rsi = require('./rsi');
const mddMeanReversion = require('./mddMeanReversion');

const registry = {
  rsi,
  mdd_mean_reversion: mddMeanReversion
};

function getStrategy(type) {
  return registry[type] ?? null;
}

function calculateTradingStrategy(baseResult, config) {
  const type = config?.type ?? 'rsi';
  const strategy = getStrategy(type);
  if (!strategy) throw new Error(`Неизвестный тип стратегии: ${type}`);
  return strategy.calculate(baseResult, config ?? {});
}

module.exports = {
  registry,
  getStrategy,
  calculateTradingStrategy
};
