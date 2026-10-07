import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
import CompareGrid from "@/components/CompareGrid.vue";
import type { CompareResult } from "@/types/models";

const result: CompareResult = {
  site: { id: "site-1", name: "校园银杏道" },
  species: { id: "sp-1", commonName: "银杏", category: "PLANT" },
  phenophase: { id: "ph-1", name: "发芽", color: "#3F6F52" },
  years: [
    {
      year: 2024,
      onsetDate: "2024-03-18",
      dayOfYear: 77,
      offsetVsPrevYear: null,
      offsetVsBaseline: null,
      baselineDayOfYear: null,
      offsetText: "暂无对比",
      observationId: "obs-2024",
      observationsInYear: 1,
      title: "银杏发芽（2024）",
      notes: "芽鳞微裂",
      phenophase: { id: "ph-1", name: "发芽", color: "#3F6F52" },
      photo: null,
      photoCount: 0,
    },
    {
      year: 2025,
      onsetDate: "2025-03-12",
      dayOfYear: 71,
      offsetVsPrevYear: -6,
      offsetVsBaseline: -6,
      baselineDayOfYear: 77,
      offsetText: "提前 6 天",
      observationId: "obs-2025",
      observationsInYear: 1,
      title: "银杏发芽（2025）",
      notes: "约三分之一芽已显绿",
      phenophase: { id: "ph-1", name: "发芽", color: "#3F6F52" },
      photo: { thumbUrl: "/files/thumb/2025/03/b.webp", displayUrl: "/files/display/2025/03/b.webp" },
      photoCount: 1,
    },
  ],
  baseline: { method: "median", yearsUsed: [2023, 2024], dayOfYear: 77 },
  missingYears: [],
};

describe("CompareGrid", () => {
  it("展示逐年首现日与偏移文案", () => {
    const wrapper = mount(CompareGrid, { props: { result } });
    expect(wrapper.text()).toContain("2024 年 3 月 18 日");
    expect(wrapper.text()).toContain("2025 年 3 月 12 日");
    expect(wrapper.text()).toContain("比上一年提前 6 天");
    expect(wrapper.text()).toContain("约三分之一芽已显绿");
  });

  it("缺少年份时给出补录入口", async () => {
    const withMissing: CompareResult = {
      ...result,
      years: [
        ...result.years,
        {
          ...result.years[0],
          year: 2023,
          onsetDate: null,
          dayOfYear: null,
          observationId: null,
          notes: null,
          photo: null,
        },
      ],
      missingYears: [2023],
    };

    const wrapper = mount(CompareGrid, { props: { result: withMissing } });
    expect(wrapper.text()).toContain("该年无记录");

    const button = wrapper.findAll("button").find((item) => item.text().includes("去补录"));
    await button?.trigger("click");
    expect(wrapper.emitted("createFor")?.[0]).toEqual([2023]);
  });
});
