import { useEffect, useRef, useState } from 'react';
import {
  dispose,
  init,
  registerLocale,
  registerOverlay,
  type AxisCreateRangeParams,
  type AxisRange,
  type Chart,
  type Crosshair,
  type DeepPartial,
  type Point,
  type Styles,
  utils,
} from 'klinecharts';
import type { Theme } from '../../data/preferences';
import type { Holding, StockMarket } from '../../data/stocks';
import { useT } from '../../i18n';
import {
  MAIN_INDICATORS,
  formatPrice,
  priceAxis,
  weekdaysAfter,
  type Candle,
  type RangeBox,
  type StockIndicator,
  type TradeMark,
} from '../../lib/stocks';
import styles from './StockChart.module.css';

// Daily candles drawn by KLineChart: its own indicators, one range box per earnings report and, from a congress
// trade, the member's buy and sell days. Everything is drawn through KLineChart's public API (styles, overlays,
// actions); the boxes are placed by candle index, so the latest one reaches into the space after today.

const CANDLE_PANE = 'candle_pane';
const BOX_GROUP = 'lac-boxes';
const MARK_GROUP = 'lac-marks';

const RED = '#dc2626';
const GREEN = '#16a34a';
const FLAT = '#94a3b8';

/** The site's font for every text the chart draws (its default falls back to serif where Helvetica is missing). */
const FONT = "Inter, system-ui, -apple-system, 'Segoe UI', sans-serif";

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

interface BoxData {
  latest: boolean;
  median: number;
  fair: number;
  /** Only the latest box is labelled. */
  label: string | null;
  dark: boolean;
}

/** Box colours: past boxes grey, the latest blue; the fair price is always the blue line. */
const boxColors = (dark: boolean) => ({
  past: dark ? '#64748b' : '#94a3b8',
  latest: dark ? '#60a5fa' : '#1d4ed8',
  pastFair: dark ? 'rgba(96, 165, 250, 0.55)' : 'rgba(29, 78, 216, 0.45)',
  median: dark ? '#64748b' : '#94a3b8',
  labelText: dark ? '#0b1220' : '#ffffff',
});

// One report's range: the outline is the top and bottom of the range, a thin grey dashed line the median, a solid
// blue line the fair price. Points: (start, upper) and (end, lower).
registerOverlay<BoxData>({
  name: 'lacRangeBox',
  totalStep: 3,
  needDefaultPointFigure: false,
  needDefaultXAxisFigure: false,
  needDefaultYAxisFigure: false,
  createPointFigures: ({ coordinates, overlay, yAxis }) => {
    const [{ x: left, y: top }, { x: right, y: bottom }] = coordinates;
    const { latest, median, fair, label, dark } = overlay.extendData;
    const colors = boxColors(dark);
    const y = (value: number) => yAxis?.convertToPixel(value) ?? 0;
    const across = (at: number) => [
      { x: left, y: at },
      { x: right, y: at },
    ];
    const figures: { type: string; attrs: unknown; styles: unknown }[] = [
      {
        type: 'line',
        attrs: {
          coordinates: [
            { x: left, y: top },
            { x: right, y: top },
            { x: right, y: bottom },
            { x: left, y: bottom },
            { x: left, y: top },
          ],
        },
        styles: { style: 'solid', size: latest ? 1.5 : 1, color: latest ? colors.latest : colors.past },
      },
      {
        type: 'line',
        attrs: { coordinates: across(y(median)) },
        styles: { style: 'dashed', dashedValue: [4, 3], size: 1, color: colors.median },
      },
      {
        type: 'line',
        attrs: { coordinates: across(y(fair)) },
        styles: { style: 'solid', size: latest ? 2 : 1.5, color: latest ? colors.latest : colors.pastFair },
      },
    ];
    if (label) {
      figures.push({
        type: 'text',
        attrs: { x: left + 6, y: y(fair) - 3, text: label, baseline: 'bottom' },
        styles: {
          style: 'fill',
          color: colors.labelText,
          size: 12,
          family: FONT,
          weight: 600,
          backgroundColor: colors.latest,
          borderRadius: 3,
          paddingLeft: 6,
          paddingRight: 6,
          paddingTop: 3,
          paddingBottom: 3,
        },
      });
    }
    return figures;
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

/**
 * Taiwan colours a rise red and a fall green; the US the other way round. Nothing beyond the candles shows by
 * default: the price and indicator readouts appear under the crosshair, and there is no title, no high and low
 * labels, no last-price line and no vertical grid.
 */
function chartStyles(market: StockMarket): DeepPartial<Styles> {
  const [up, down] = market === 'tw' ? [RED, GREEN] : [GREEN, RED];
  const text = { family: FONT };
  return {
    grid: { vertical: { show: false } },
    xAxis: { tickText: text },
    yAxis: { tickText: text },
    crosshair: { horizontal: { text }, vertical: { text } },
    overlay: { text },
    candle: {
      tooltip: { showRule: 'follow_cross', title: { show: false, ...text }, legend: text },
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
        high: { show: false },
        low: { show: false },
        last: { upColor: up, downColor: down, noChangeColor: FLAT, line: { show: false }, text },
      },
    },
    indicator: {
      tooltip: { showRule: 'follow_cross', title: text, legend: text },
      lastValueMark: { text },
      ohlc: { upColor: up, downColor: down, noChangeColor: FLAT },
      bars: [{ upColor: `${up}99`, downColor: `${down}99`, noChangeColor: FLAT }],
    },
  };
}

/**
 * The candle pane's price range: the candles in view, widened to the latest box when it is in view (past boxes are
 * cut off). KLineChart asks again after every drag or zoom.
 */
const fitLatestBox =
  (boxes: { current: RangeBox[] }) =>
  ({ chart, defaultRange }: AxisCreateRangeParams): AxisRange => {
    const { realFrom, realTo } = chart.getVisibleRange();
    let { from, to } = priceAxis(defaultRange, boxes.current, { from: realFrom, to: realTo });
    const pad = (to - from) * 0.03;
    [from, to] = [from - pad, to + pad];
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
  holding: Holding;
  /** One box per earnings report for the holding period; the last one is the latest. */
  boxes: RangeBox[];
  /** Opening view in candles: the last year, and the space after the last candle. */
  view: { past: number; future: number };
  indicators: StockIndicator[];
  /** Congress trade days of one member on this stock; empty when the stock was opened from anywhere else. */
  marks: TradeMark[];
  /** Day to bring into view (the clicked trade), or null for the opening view. */
  focus: number | null;
  theme: Theme;
}

type Hover = { x: number; y: number } & ({ mark: TradeMark; box?: never } | { box: RangeBox; mark?: never });

export function StockChart({
  code,
  market,
  candles,
  holding,
  boxes,
  view,
  indicators,
  marks,
  focus,
  theme,
}: StockChartProps) {
  const t = useT();
  const st = t.stocks;
  const boxRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<Chart | null>(null);
  const dataRef = useRef(candles);
  const marksRef = useRef(marks);
  const boxesRef = useRef(boxes);
  const shownRef = useRef(new Set<StockIndicator>());
  const [hover, setHover] = useState<Hover | null>(null);
  marksRef.current = marks;
  boxesRef.current = boxes;

  useEffect(() => {
    const box = boxRef.current!;
    // Zooming out may go below KLineChart's default 1px per candle, so a Q+12 box fits on screen with its candles.
    const chart = init(box, { timezone: 'UTC', styles: theme, layout: { barSpaceLimit: { min: 0.5 } } })!;
    chartRef.current = chart;
    chart.setPeriod({ type: 'day', span: 1 });
    chart.setDataLoader({
      getBars: ({ callback }) =>
        callback(
          dataRef.current.map((c) => ({ ...c })),
          false,
        ),
    });
    // Past the last candle KLineChart counts one calendar day per candle, but the candles (and the boxes) are
    // weekdays: a date there is the last candle's day plus that many weekdays, on the axis and under the crosshair.
    chart.setFormatter({
      formatDate: ({ dateTimeFormat, timestamp, template }) => {
        const last = dataRef.current[dataRef.current.length - 1]?.timestamp ?? timestamp;
        const day = timestamp > last ? weekdaysAfter(last, Math.round((timestamp - last) / 86_400_000)) : timestamp;
        return utils.formatDate(dateTimeFormat, day, template);
      },
    });
    chart.overrideYAxis({ paneId: CANDLE_PANE, createRange: fitLatestBox(boxesRef) });
    // A mark's or a box's details show while the crosshair is on it (the action gives the crosshair's x and y).
    chart.subscribeAction('onCrosshairChange', (data) => {
      const { x, y } = (data as Crosshair | undefined) ?? {};
      if (x === undefined || y === undefined) {
        setHover(null);
        return;
      }
      const [point] = chart.convertFromPixel([{ x, y }], { paneId: CANDLE_PANE }) as Partial<Point>[];
      const mark = marksRef.current.find((m) => m.timestamp === point?.timestamp);
      if (mark) {
        setHover({ mark, x, y });
        return;
      }
      const index = point?.dataIndex ?? -1;
      const value = point?.value ?? NaN;
      const over = boxesRef.current.find(
        (b) => index >= b.start && index <= b.end && value >= b.range.lower && value <= b.range.upper,
      );
      setHover(over ? { box: over, x, y } : null);
    });
    const observer = new ResizeObserver(() => chart.resize());
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
    chart.setStyles(chartStyles(market));
  }, [theme, market]);

  // A new stock reloads the candles through the data loader and opens on the last year plus the space after it.
  useEffect(() => {
    const chart = chartRef.current!;
    dataRef.current = candles;
    setHover(null);
    // Taiwan prices from 100 up have no decimals, as in the list; everything else two.
    const whole = market === 'tw' && candles[candles.length - 1].close >= 100;
    chart.setSymbol({ ticker: code, pricePrecision: whole ? 0 : 2, volumePrecision: 0 });
    const width = chart.getSize(CANDLE_PANE, 'main')?.width ?? 0;
    if (width > 0) {
      const space = width / (view.past + view.future);
      chart.setBarSpace(space);
      chart.setOffsetRightDistance(view.future * space);
      chart.scrollToRealTime();
    }
  }, [code, market, candles, view.past, view.future]);

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
    chart.removeOverlay({ groupId: BOX_GROUP });
    for (const box of boxes) {
      chart.createOverlay({
        name: 'lacRangeBox',
        groupId: BOX_GROUP,
        lock: true,
        points: [
          { dataIndex: box.start, value: box.range.upper },
          { dataIndex: box.end, value: box.range.lower },
        ],
        extendData: {
          latest: box.latest,
          median: box.range.median,
          fair: box.range.fair,
          label: box.latest ? st.fairLabel(formatPrice(market, box.range.fair)) : null,
          dark,
        },
      });
    }
    // The price range follows the latest box of the new holding period.
    chart.overrideYAxis({ paneId: CANDLE_PANE, createRange: fitLatestBox(boxesRef) });
  }, [boxes, market, theme, st]);

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
          label: st.congress.markLetter[mark.side],
          color: mark.side === 'buy' ? GREEN : RED,
        },
      });
    }
  }, [candles, marks, st]);

  // Bring the clicked trade to the middle of the view.
  useEffect(() => {
    const chart = chartRef.current!;
    if (focus === null) return;
    const index = candles.findIndex((c) => c.timestamp === focus);
    const visible = (chart.getSize(CANDLE_PANE, 'main')?.width ?? 0) / chart.getBarSpace().bar;
    if (index >= 0) chart.scrollToDataIndex(Math.min(candles.length - 1, index + Math.floor(visible / 2)));
  }, [candles, focus]);

  const price = (value: number) => formatPrice(market, value);
  return (
    <div className={styles.chart} onMouseLeave={() => setHover(null)}>
      <div ref={boxRef} className={styles.canvas} aria-label={st.chartLabel(code)} role="img" />
      {hover && (
        <div className={styles.tooltip} style={{ left: hover.x + 14, top: Math.max(8, hover.y - 30) }}>
          {hover.mark ? (
            <>
              <strong className={hover.mark.side === 'buy' ? styles.buy : styles.sell}>
                {st.congress.side[hover.mark.side]} · {t.day(hover.mark.tradedOn)}
              </strong>
              <span>
                {st.congress.filed} {t.day(hover.mark.filedOn)}
              </span>
              <span>{hover.mark.amount}</span>
            </>
          ) : (
            <dl className={styles.boxInfo}>
              <dt>{st.box.reported}</dt>
              <dd>{t.day(hover.box.from)}</dd>
              <dt>{st.holding}</dt>
              <dd>{holding}</dd>
              <dt>{st.box.upper}</dt>
              <dd>{price(hover.box.range.upper)}</dd>
              <dt>{st.box.median}</dt>
              <dd>{price(hover.box.range.median)}</dd>
              <dt>{st.box.lower}</dt>
              <dd>{price(hover.box.range.lower)}</dd>
              <dt>{st.columns.fair}</dt>
              <dd className={styles.fair}>{price(hover.box.range.fair)}</dd>
            </dl>
          )}
        </div>
      )}
    </div>
  );
}
