import { defineStore } from "pinia";
import type { Photo } from "@/types/models";

export const useUiStore = defineStore("ui", {
  state: () => ({
    lightboxOpen: false,
    lightboxPhotos: [] as Photo[],
    lightboxIndex: 0,
  }),
  actions: {
    openLightbox(photos: Photo[], index = 0) {
      this.lightboxPhotos = photos;
      this.lightboxIndex = index;
      this.lightboxOpen = true;
    },
    closeLightbox() {
      this.lightboxOpen = false;
      this.lightboxPhotos = [];
      this.lightboxIndex = 0;
    },
  },
});
