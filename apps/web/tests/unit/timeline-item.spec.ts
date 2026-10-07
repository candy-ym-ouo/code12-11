import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
import TimelineItem from "@/components/TimelineItem.vue";
import type { Observation } from "@/types/models";

const observation: Observation = {
  id: "obs-1",
  kind: "PLANT_PHENOLOGY",
  status: "PUBLISHED",
  observationDate: "2025-03-12",
  observedAt: null,
  title: "银杏发芽（2025）",
  notes: "约三分之一芽已显绿",
  temperatureC: 12.8,
  precipitationMm: null,
  windLevel: null,
  humidityPct: null,
  anomalyType: null,
  anomalySeverity: null,
  impactNotes: null,
  source: "MANUAL",
  site: { id: "site-1", name: "校园银杏道", latitude: null, longitude: null },
  species: { id: "sp-1", commonName: "银杏", category: "PLANT", scientificName: "Ginkgo biloba" },
  phenophase: { id: "ph-1", name: "发芽", color: "#3F6F52" },
  photos: [
    {
      id: "photo-1",
      thumbUrl: "/files/thumb/2025/03/a.webp",
      displayUrl: "/files/display/2025/03/a.webp",
      width: 1600,
      height: 1200,
      bytes: 1024,
      takenAt: null,
      sortOrder: 0,
    },
  ],
  tags: [{ id: "tag-1", name: "倒春寒后", color: "#B0793A" }],
  createdAt: "2025-03-12T08:00:00.000Z",
  updatedAt: "2025-03-12T08:00:00.000Z",
};

describe("TimelineItem", () => {
  it("展示日期、物种、阶段与描述", () => {
    const wrapper = mount(TimelineItem, { props: { observation } });
    expect(wrapper.text()).toContain("银杏发芽（2025）");
    expect(wrapper.text()).toContain("校园银杏道");
    expect(wrapper.text()).toContain("发芽");
    expect(wrapper.text()).toContain("约三分之一芽已显绿");
    expect(wrapper.text()).toContain("倒春寒后");
    expect(wrapper.find("img").attributes("src")).toBe("/files/thumb/2025/03/a.webp");
  });

  it("点击卡片与照片分别触发事件", async () => {
    const wrapper = mount(TimelineItem, { props: { observation } });
    await wrapper.find("article").trigger("click");
    expect(wrapper.emitted("open")?.[0]).toEqual(["obs-1"]);

    await wrapper.find("button").trigger("click");
    expect(wrapper.emitted("openPhotos")?.[0]?.[1]).toBe(0);
  });

  it("草稿状态显示草稿标签", () => {
    const wrapper = mount(TimelineItem, { props: { observation: { ...observation, status: "DRAFT" } } });
    expect(wrapper.text()).toContain("草稿");
  });
});
