-- CreateTable
CREATE TABLE "Transect" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "ownerId" TEXT NOT NULL,
    "siteId" TEXT,
    "name" TEXT NOT NULL,
    "code" TEXT,
    "description" TEXT,
    "lengthM" REAL NOT NULL DEFAULT 0,
    "archivedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Transect_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Transect_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "TransectSegment" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "transectId" TEXT NOT NULL,
    "orderIndex" INTEGER NOT NULL,
    "startM" REAL NOT NULL,
    "endM" REAL NOT NULL,
    "name" TEXT NOT NULL,
    "habitat" TEXT,
    "geometry" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "TransectSegment_transectId_fkey" FOREIGN KEY ("transectId") REFERENCES "Transect" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "TransectEntry" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "transectId" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "segmentId" TEXT,
    "speciesId" TEXT,
    "speciesName" TEXT NOT NULL,
    "category" TEXT,
    "startAt" DATETIME NOT NULL,
    "endAt" DATETIME NOT NULL,
    "startM" REAL NOT NULL,
    "endM" REAL NOT NULL,
    "count" INTEGER NOT NULL,
    "observer" TEXT,
    "notes" TEXT,
    "source" TEXT NOT NULL DEFAULT 'MANUAL',
    "observedAt" DATETIME NOT NULL,
    "recordedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "supersedesEntryId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "TransectEntry_transectId_fkey" FOREIGN KEY ("transectId") REFERENCES "Transect" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "TransectEntry_segmentId_fkey" FOREIGN KEY ("segmentId") REFERENCES "TransectSegment" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "TransectEntry_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "TransectConflict" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "transectId" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "speciesName" TEXT NOT NULL,
    "entryAId" TEXT NOT NULL,
    "entryBId" TEXT NOT NULL,
    "startM" REAL NOT NULL,
    "endM" REAL NOT NULL,
    "startAt" DATETIME NOT NULL,
    "endAt" DATETIME NOT NULL,
    "countA" INTEGER NOT NULL,
    "countB" INTEGER NOT NULL,
    "resolution" TEXT NOT NULL DEFAULT 'PENDING',
    "resolvedAt" DATETIME,
    "resolvedNote" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "TransectConflict_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "Transect_ownerId_archivedAt_idx" ON "Transect"("ownerId", "archivedAt");

-- CreateIndex
CREATE UNIQUE INDEX "Transect_ownerId_name_key" ON "Transect"("ownerId", "name");

-- CreateIndex
CREATE INDEX "TransectSegment_transectId_startM_idx" ON "TransectSegment"("transectId", "startM");

-- CreateIndex
CREATE UNIQUE INDEX "TransectSegment_transectId_orderIndex_key" ON "TransectSegment"("transectId", "orderIndex");

-- CreateIndex
CREATE INDEX "TransectEntry_transectId_speciesName_startAt_idx" ON "TransectEntry"("transectId", "speciesName", "startAt");

-- CreateIndex
CREATE INDEX "TransectEntry_transectId_startM_endM_idx" ON "TransectEntry"("transectId", "startM", "endM");

-- CreateIndex
CREATE INDEX "TransectEntry_ownerId_source_idx" ON "TransectEntry"("ownerId", "source");

-- CreateIndex
CREATE INDEX "TransectConflict_transectId_resolution_idx" ON "TransectConflict"("transectId", "resolution");

-- CreateIndex
CREATE INDEX "TransectConflict_ownerId_resolution_idx" ON "TransectConflict"("ownerId", "resolution");

-- CreateIndex
CREATE UNIQUE INDEX "TransectConflict_entryAId_entryBId_key" ON "TransectConflict"("entryAId", "entryBId");
