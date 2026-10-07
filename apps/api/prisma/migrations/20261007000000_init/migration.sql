-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'USER',
    "timezone" TEXT NOT NULL DEFAULT 'Asia/Shanghai',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "RefreshToken" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" DATETIME NOT NULL,
    "revokedAt" DATETIME,
    "userAgent" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "RefreshToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Site" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "ownerId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "latitude" REAL,
    "longitude" REAL,
    "elevationM" INTEGER,
    "habitat" TEXT,
    "description" TEXT,
    "archivedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Site_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Species" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "ownerId" TEXT,
    "category" TEXT NOT NULL,
    "commonName" TEXT NOT NULL,
    "scientificName" TEXT,
    "family" TEXT,
    "description" TEXT,
    "isPreset" BOOLEAN NOT NULL DEFAULT false,
    "archivedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Species_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Phenophase" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "speciesId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT,
    "orderIndex" INTEGER NOT NULL DEFAULT 0,
    "color" TEXT NOT NULL DEFAULT '#3F6F52',
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    CONSTRAINT "Phenophase_speciesId_fkey" FOREIGN KEY ("speciesId") REFERENCES "Species" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Observation" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "ownerId" TEXT NOT NULL,
    "siteId" TEXT NOT NULL,
    "speciesId" TEXT,
    "phenophaseId" TEXT,
    "kind" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PUBLISHED',
    "observationDate" TEXT NOT NULL,
    "observedAt" DATETIME,
    "title" TEXT,
    "notes" TEXT,
    "temperatureC" REAL,
    "precipitationMm" REAL,
    "windLevel" INTEGER,
    "humidityPct" INTEGER,
    "anomalyType" TEXT,
    "anomalySeverity" TEXT,
    "impactNotes" TEXT,
    "source" TEXT NOT NULL DEFAULT 'MANUAL',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Observation_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Observation_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Observation_speciesId_fkey" FOREIGN KEY ("speciesId") REFERENCES "Species" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Observation_phenophaseId_fkey" FOREIGN KEY ("phenophaseId") REFERENCES "Phenophase" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ObservationPhoto" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "observationId" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "thumbKey" TEXT NOT NULL,
    "displayKey" TEXT NOT NULL,
    "originalName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "width" INTEGER NOT NULL,
    "height" INTEGER NOT NULL,
    "bytes" INTEGER NOT NULL,
    "takenAt" DATETIME,
    "gpsStripped" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ObservationPhoto_observationId_fkey" FOREIGN KEY ("observationId") REFERENCES "Observation" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Tag" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "ownerId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "color" TEXT NOT NULL DEFAULT '#B0793A',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Tag_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ObservationTag" (
    "observationId" TEXT NOT NULL,
    "tagId" TEXT NOT NULL,

    PRIMARY KEY ("observationId", "tagId"),
    CONSTRAINT "ObservationTag_observationId_fkey" FOREIGN KEY ("observationId") REFERENCES "Observation" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ObservationTag_tagId_fkey" FOREIGN KEY ("tagId") REFERENCES "Tag" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ShareLink" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "token" TEXT NOT NULL,
    "siteId" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "scope" TEXT NOT NULL DEFAULT 'TIMELINE',
    "expiresAt" DATETIME NOT NULL,
    "revokedAt" DATETIME,
    "viewCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ShareLink_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ShareLink_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "RefreshToken_tokenHash_key" ON "RefreshToken"("tokenHash");

-- CreateIndex
CREATE INDEX "RefreshToken_userId_idx" ON "RefreshToken"("userId");

-- CreateIndex
CREATE INDEX "Site_ownerId_archivedAt_idx" ON "Site"("ownerId", "archivedAt");

-- CreateIndex
CREATE UNIQUE INDEX "Site_ownerId_name_key" ON "Site"("ownerId", "name");

-- CreateIndex
CREATE INDEX "Species_ownerId_category_commonName_idx" ON "Species"("ownerId", "category", "commonName");

-- CreateIndex
CREATE INDEX "Species_category_commonName_idx" ON "Species"("category", "commonName");

-- CreateIndex
CREATE INDEX "Species_isPreset_idx" ON "Species"("isPreset");

-- CreateIndex
CREATE INDEX "Phenophase_speciesId_orderIndex_idx" ON "Phenophase"("speciesId", "orderIndex");

-- CreateIndex
CREATE UNIQUE INDEX "Phenophase_speciesId_name_key" ON "Phenophase"("speciesId", "name");

-- CreateIndex
CREATE INDEX "Observation_ownerId_status_observationDate_idx" ON "Observation"("ownerId", "status", "observationDate");

-- CreateIndex
CREATE INDEX "Observation_siteId_speciesId_phenophaseId_observationDate_idx" ON "Observation"("siteId", "speciesId", "phenophaseId", "observationDate");

-- CreateIndex
CREATE INDEX "Observation_ownerId_kind_observationDate_idx" ON "Observation"("ownerId", "kind", "observationDate");

-- CreateIndex
CREATE INDEX "Observation_siteId_observationDate_idx" ON "Observation"("siteId", "observationDate");

-- CreateIndex
CREATE UNIQUE INDEX "ObservationPhoto_storageKey_key" ON "ObservationPhoto"("storageKey");

-- CreateIndex
CREATE INDEX "ObservationPhoto_observationId_sortOrder_idx" ON "ObservationPhoto"("observationId", "sortOrder");

-- CreateIndex
CREATE UNIQUE INDEX "Tag_ownerId_name_key" ON "Tag"("ownerId", "name");

-- CreateIndex
CREATE INDEX "ObservationTag_tagId_idx" ON "ObservationTag"("tagId");

-- CreateIndex
CREATE UNIQUE INDEX "ShareLink_token_key" ON "ShareLink"("token");

-- CreateIndex
CREATE INDEX "ShareLink_siteId_revokedAt_idx" ON "ShareLink"("siteId", "revokedAt");

