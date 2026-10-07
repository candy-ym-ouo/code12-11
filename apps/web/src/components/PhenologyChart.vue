<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from "vue";
import * as echarts from "echarts/core";
import { BarChart, LineChart } from "echarts/charts";
import { GridComponent, LegendComponent, TooltipComponent } from "echarts/components";
import { CanvasRenderer } from "echarts/renderers";
import type { PhenologyResult } from "@/types/models";

echarts.use([LineChart, BarChart, GridComponent, TooltipComponent, LegendComponent, CanvasRenderer]);

const props = defineProps<{ items: PhenologyResult["items"] }>();

const lineRef = ref<HTMLDivElement | null>(null);
const barRef = ref<HTMLDivElement | null>(null);
let lineChart: echarts.ECharts | null = null;
let barChart: echarts.ECharts | null = null;

function render() {
  const valid = props.items.filter((item) => item.dayOfYear !== null);

  if (lineRef.value) {
    lineChart = lineChart ?? echarts.init(lineRef.value);
    lineChart.setOption({
      grid: { left: 48, right: 20, top: 40, bottom: 32 },
      tooltip: {
        trigger: "axis",
        formatter: (params: unknown) => {
          const list = params as Array<{ dataIndex: number }>;
          const item = valid[list[0]?.dataIndex ?? 0];
          return item ? `${item.year} 年：${item.onsetDate}（第 ${item.dayOfYear} 天）` : "";
        },
      },
      xAxis: { type: "category", data: valid.map((item) => String(item.year)), boundaryGap: false },
      yAxis: { type: "value", name: "序日", min: "dataMin", max: "dataMax" },
      series: [
        {
          name: "首现日",
          type: "line",
          smooth: true,
          symbolSize: 8,
          data: valid.map((item) => item.dayOfYear),
          itemStyle: { color: "#3F6F52" },
          areaStyle: { color: "rgba(63, 111, 82, 0.12)" },
        },
      ],
    });
  }

  if (barRef.value) {
    barChart = barChart ?? echarts.init(barRef.value);
    const offsets = valid.filter((item) => item.offsetVsBaseline !== null);
    barChart.setOption({
      grid: { left: 48, right: 20, top: 40, bottom: 32 },
      tooltip: {
        trigger: "axis",
        formatter: (params: unknown) => {
          const list = params as Array<{ dataIndex: number }>;
          const item = offsets[list[0]?.dataIndex ?? 0];
          if (!item) return "";
          return `${item.year} 年：${item.offsetText}（基准第 ${item.baselineDayOfYear} 天）`;
        },
      },
      xAxis: { type: "category", data: offsets.map((item) => String(item.year)) },
      yAxis: { type: "value", name: "偏移（天）" },
      series: [
        {
          name: "相对基准",
          type: "bar",
          barMaxWidth: 40,
          data: offsets.map((item) => ({
            value: item.offsetVsBaseline,
            itemStyle: { color: (item.offsetVsBaseline ?? 0) <= 0 ? "#3F6F52" : "#B0793A" },
          })),
        },
      ],
    });
  }
}

function resize() {
  lineChart?.resize();
  barChart?.resize();
}

onMounted(() => {
  render();
  window.addEventListener("resize", resize);
});

watch(
  () => props.items,
  () => render(),
  { deep: true },
);

onBeforeUnmount(() => {
  window.removeEventListener("resize", resize);
  lineChart?.dispose();
  barChart?.dispose();
  lineChart = null;
  barChart = null;
});
</script>

<template>
  <div class="charts">
    <section class="card charts__block">
      <h3 class="charts__title">逐年首现日</h3>
      <div ref="lineRef" class="charts__canvas" role="img" aria-label="逐年首现日折线图"></div>
    </section>
    <section class="card charts__block">
      <h3 class="charts__title">相对多年基准的偏移</h3>
      <div ref="barRef" class="charts__canvas" role="img" aria-label="相对基准的偏移柱状图"></div>
    </section>
  </div>
</template>

<style scoped>
.charts {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(320px, 1fr));
  gap: 12px;
}

.charts__block {
  padding: 14px;
}

.charts__title {
  margin: 0 0 8px;
  font-size: 15px;
  font-weight: 600;
}

.charts__canvas {
  width: 100%;
  height: 300px;
}
</style>
