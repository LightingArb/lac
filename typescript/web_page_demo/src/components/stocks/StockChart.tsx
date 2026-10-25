import { useEffect, useRef, useState } from 'react';
import {
  dispose,
  init,
  registerLocale,
  registerOverlay,
  type AxisRange,
  type Chart,
  type Crosshair,
  type DeepPartial,
  type Point,
  type Styles,
} from 'klinecharts';
import type { Theme } from '../../data/preferences';
import type { StockMarket } from '../../data/stocks';
import { useT } from '../../i18n';
import { MAIN_INDICATORS, type Candle, type StockIndicator, type TradeMark } from '../../lib/stocks';
import styles from './StockChart.module.css';

// Daily candles drawn by KLineChart: its own indicators, a fair-price line and, from a congress trade, the member's
// buy and sell days. Everything is drawn through KLineChart's public API (styles, overlays, actions).

const CANDLE_PANE = 'candle_pane';
const FAIR_GROUP = 'lac-fair';
const MARK_GROUP = 'lac-marks';

/** Narrower than this (px), the chart shows its price readouts only under the crosshair. */
const NARROW_CHART = 560;

const RED = '#dc2626';
const GREEN = '#16a34a';
const FLAT = '#94a3b8';

registerLocale('zh-TW', {
  time: '時間：',
  open: '開：',
  high: '高：',
  low: '低：',
  close: '收：',
  volume: '成交量：',
  turnover: '成交額：',
  change: '漲幅：',
  second: '秒',
  minute: '',
  hour: '小時',
  day: '天',
  week: '週',
  month: '月',
  year: '年',
});

interface FairData {
  text: string;
  color: string;
  textColor: string;
}

// The fair price: a dashed line across the candle pane, its label at the left end.
registerOverlay<FairData>({
  name: 'lacFairPrice',
  totalStep: 2,
  needDefaultPointFigure: false,
  needDefaultXAxisFigure: false,
  needDefaultYAxisFigure: false,
  createPointFigures: ({ coordinates, bounding, overlay }) => {
    const { y } = coordinates[0];
    const { text, color, textColor } = overlay.extendData;
    return [
      {
        type: 'line',
        attrs: {
          coordinates: [
            { x: 0, y },
            { x: bounding.width, y },
          ],
        },
        styles: { style: 'dashed', dashedValue: [6, 4], size: 1.5, color },
      },
      {
        type: 'text',
        attrs: { x: 8, y: y - 3, text, baseline: 'bottom' },
        styles: {
          style: 'fill',
          color: textColor,
          size: 12,
          family: FONT,
          weight: 600,
          backgroundColor: color,
          borderRadius: 3,
          paddingLeft: 6,
          paddingRight: 6,
          paddingTop: 3,
          paddingBottom: 3,
        },
      },
    ];
  },
});

interface MarkData {
  side: 'buy' | 'sell';
  label: string;
  color: string;
}

// A congress trade day: a badge below the low for a buy, above the high for a sell, with an arrow to the candle.
registerOverlay<MarkData>({
  name: 'lacTradeMark',
  totalStep: 2,
  needDefaultPointFigure: false,
  needDefaultXAxisFigure: false,
  needDefaultYAxisFigure: false,
  createPointFigures: ({ coordinates, overlay }) => {
    const { x, y } = coordinates[0];
    const { side, label, color } = overlay.extendData;
    const away = side === 'buy' ? 1 : -1;
    const tip = y + away * 4;
    const base = tip + away * 7;
    const center = base + away * 9;
    return [
      {
        type: 'polygon',
        attrs: {
          coordinates: [
            { x, y: tip },
            { x: x - 5, y: base },
            { x: x + 5, y: base },
          ],
        },
        styles: { style: 'fill', color },
      },
      { type: 'circle', attrs: { x, y: center, r: 9 }, styles: { style: 'fill', color } },
      {
        type: 'text',
        attrs: { x, y: center, text: label, align: 'center', baseline: 'middle' },
        styles: {
          style: 'fill',
          color: '#ffffff',
          size: 10,
          family: FONT,
          weight: 700,
          backgroundColor: 'transparent',
        },
      },
    ];
  },
});

/** The site's font for every text the chart draws (its default falls back to serif where Helvetica is missing). */
const FONT = "Inter, system-ui, -apple-system, 'Segoe UI', sans-serif";

/** Taiwan colours a rise red and a fall green; the US the other way round. */
function marketStyles(market: StockMarket): DeepPartial<Styles> {
  const [up, down] = market === 'tw' ? [RED, GREEN] : [GREEN, RED];
  const text = { family: FONT };
  return {
    xAxis: { tickText: text },
    yAxis: { tickText: text },
    crosshair: { horizontal: { text }, vertical: { text } },
    overlay: { text },
    candle: {
      tooltip: { title: text, legend: text },
      bar: {
        upColor: up,
        downColor: down,
        noChangeColor: FLAT,
        upBorderColor: up,
        downBorderColor: down,
        noChangeBorderColor: FLAT,
        upWickColor: up,
        downWickColor: down,
        noChangeWickColor: FLAT,
      },
      priceMark: {
        high: { textFamily: FONT },
        low: { textFamily: FONT },
        last: { upColor: up, downColor: down, noChangeColor: FLAT, text },
      },
    },
    indicator: {
      tooltip: { title: text, legend: text },
      lastValueMark: { text },
      ohlc: { upColor: up, downColor: down, noChangeColor: FLAT },
      bars: [{ upColor: `${up}99`, downColor: `${down}99`, noChangeColor: FLAT }],
    },
  };
}

/** The candle pane's price range, widened when needed so the fair-price line is always on screen. */
const includeValue =
  (value: number) =>
  ({ defaultRange }: { defaultRange: AxisRange }): AxisRange => {
    const pad = (defaultRange.to - defaultRange.from) * 0.04;
    const from = Math.min(defaultRange.from, value - pad);
    const to = Math.max(defaultRange.to, value + pad);
    const range = to - from;
    return {
      ...defaultRange,
      from,
      to,
      range,
      realFrom: from,
      realTo: to,
      realRange: range,
      displayFrom: from,
      displayTo: to,
      displayRange: range,
    };
  };

interface StockChartProps {
  code: string;
  market: StockMarket;
  candles: Candle[];
  fair: { price: number; label: string };
  indicators: StockIndicator[];
  /** Congress trade days of one member on this stock; empty when the stock was opened from anywhere else. */
  marks: TradeMark[];
  /** Day to bring into view (the clicked trade), or null for the latest candles. */
  focus: number | null;
  theme: Theme;
}

interface Hover {
  mark: TradeMark;
  x: number;
  y: number;
}

export function StockChart({ code, market, candles, fair, indicators, marks, focus, theme }: StockChartProps) {
  const t = useT();
  const boxRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<Chart | null>(null);
  const dataRef = useRef(candles);
  const marksRef = useRef(marks);
  const shownRef = useRef(new Set<StockIndicator>());
  const [hover, setHover] = useState<Hover | null>(null);
  marksRef.current = marks;

  useEffect(() => {
    const box = boxRef.current!;
    const chart = init(box, { timezone: 'UTC', styles: theme })!;
    chartRef.current = chart;
    chart.setBarSpace(6);
    chart.setPeriod({ type: 'day', span: 1 });
    chart.setDataLoader({
      getBars: ({ callback }) =>
        callback(
          dataRef.current.map((c) => ({ ...c })),
          false,
        ),
    });
    // A mark's details show while the crosshair is on its day (the action gives the crosshair's x, not the candle).
    chart.subscribeAction('onCrosshairChange', (data) => {
      const x = (data as Crosshair | undefined)?.x;
      const at = x === undefined ? [] : (chart.convertFromPixel([{ x }], { paneId: CANDLE_PANE }) as Partial<Point>[]);
      const timestamp = at[0]?.timestamp;
      const mark = marksRef.current.find((m) => m.timestamp === timestamp);
      const candle = dataRef.current.find((c) => c.timestamp === timestamp);
      if (!mark || !candle) {
        setHover(null);
        return;
      }
      const point = chart.convertToPixel(
        { timestamp, value: mark.side === 'buy' ? candle.low : candle.high },
        { paneId: CANDLE_PANE, absolute: true },
      ) as { x: number; y: number };
      setHover({ mark, x: point.x, y: point.y });
    });
    // On a narrow chart the price readouts show only under the crosshair, so they don't cover the candles.
    let narrow: boolean | null = null;
    const observer = new ResizeObserver(() => {
      chart.resize();
      if (narrow === box.clientWidth < NARROW_CHART) return;
      narrow = box.clientWidth < NARROW_CHART;
      const tooltip = { showRule: narrow ? 'follow_cross' : 'always' } as const;
      chart.setStyles({ candle: { tooltip }, indicator: { tooltip } });
    });
    observer.observe(box);
    shownRef.current = new Set();
    return () => {
      observer.disconnect();
      dispose(box);
      chartRef.current = null;
    };
    // The chart is made once; every later change below is applied to it.
  }, []);

  useEffect(() => {
    chartRef.current?.setLocale(t.lang === 'zh-Hant' ? 'zh-TW' : 'en-US');
  }, [t.lang]);

  useEffect(() => {
    const chart = chartRef.current!;
    chart.setStyles(theme);
    chart.setStyles(marketStyles(market));
  }, [theme, market]);

  // A new stock reloads the candles through the data loader.
  useEffect(() => {
    dataRef.current = candles;
    setHover(null);
    chartRef.current!.setSymbol({ ticker: code, pricePrecision: 2, volumePrecision: 0 });
  }, [code, candles]);

  useEffect(() => {
    const chart = chartRef.current!;
    const shown = shownRef.current;
    for (const name of [...shown].filter((n) => !indicators.includes(n))) {
      const main = (MAIN_INDICATORS as readonly string[]).includes(name);
      chart.removeIndicator({ name, paneId: main ? CANDLE_PANE : `pane_${name}` });
      shown.delete(name);
    }
    for (const name of indicators.filter((n) => !shown.has(n))) {
      if ((MAIN_INDICATORS as readonly string[]).includes(name))
        chart.createIndicator({ name, paneId: CANDLE_PANE }, true);
      else chart.createIndicator({ name, paneId: `pane_${name}` });
      shown.add(name);
    }
  }, [indicators]);

  useEffect(() => {
    const chart = chartRef.current!;
    const dark = theme === 'dark';
    chart.removeOverlay({ groupId: FAIR_GROUP });
    chart.createOverlay({
      name: 'lacFairPrice',
      groupId: FAIR_GROUP,
      lock: true,
      points: [{ timestamp: candles[candles.length - 1].timestamp, value: fair.price }],
      extendData: { text: fair.label, color: dark ? '#60a5fa' : '#1d4ed8', textColor: dark ? '#0b1220' : '#ffffff' },
    });
    chart.overrideYAxis({ paneId: CANDLE_PANE, createRange: includeValue(fair.price) });
  }, [candles, fair.price, fair.label, theme]);

  useEffect(() => {
    const chart = chartRef.current!;
    chart.removeOverlay({ groupId: MARK_GROUP });
    for (const mark of marks) {
      const candle = candles.find((c) => c.timestamp === mark.timestamp);
      if (!candle) continue;
      chart.createOverlay({
        name: 'lacTradeMark',
        groupId: MARK_GROUP,
        lock: true,
        points: [{ timestamp: mark.timestamp, value: mark.side === 'buy' ? candle.low : candle.high }],
        extendData: {
          side: mark.side,
          label: t.stocks.congress.markLetter[mark.side],
          color: mark.side === 'buy' ? GREEN : RED,
        },
      });
    }
  }, [candles, marks, t]);

  // Bring the clicked trade to the middle of the view; otherwise show the latest candles.
  useEffect(() => {
    const chart = chartRef.current!;
    if (focus === null) {
      chart.scrollToRealTime();
      return;
    }
    const index = candles.findIndex((c) => c.timestamp === focus);
    const visible = (chart.getSize(CANDLE_PANE)?.width ?? 0) / chart.getBarSpace().bar;
    if (index >= 0) chart.scrollToDataIndex(Math.min(candles.length - 1, index + Math.floor(visible / 2)));
  }, [candles, focus]);

  return (
    <div className={styles.chart} onMouseLeave={() => setHover(null)}>
      <div ref={boxRef} className={styles.canvas} aria-label={t.stocks.chartLabel(code)} role="img" />
      {hover && (
        <div className={styles.tooltip} style={{ left: hover.x + 14, top: Math.max(8, hover.y - 30) }}>
          <strong className={hover.mark.side === 'buy' ? styles.buy : styles.sell}>
            {t.stocks.congress.side[hover.mark.side]} · {t.day(hover.mark.tradedOn)}
          </strong>
          <span>
            {t.stocks.congress.filed} {t.day(hover.mark.filedOn)}
          </span>
          <span>{hover.mark.amount}</span>
        </div>
      )}
    </div>
  );
}
