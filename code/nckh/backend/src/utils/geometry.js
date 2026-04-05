function getRowValue(row, key) {
  if (key in row) return row[key];
  const snake = key.replace(/[A-Z]/g, (m) => `_${m.toLowerCase()}`);
  return row[snake];
}

function toCoord(row) {
  return [Number(getRowValue(row, "lon")), Number(getRowValue(row, "lat"))];
}

function sortRows(rows) {
  return [...rows].sort((a, b) => {
    const aPart = Number(getRowValue(a, "partIndex") || 0);
    const bPart = Number(getRowValue(b, "partIndex") || 0);
    if (aPart !== bPart) return aPart - bPart;

    const aRing = Number(getRowValue(a, "ringIndex") || 0);
    const bRing = Number(getRowValue(b, "ringIndex") || 0);
    if (aRing !== bRing) return aRing - bRing;

    const aOrder = Number(getRowValue(a, "pointOrder") || 0);
    const bOrder = Number(getRowValue(b, "pointOrder") || 0);
    return aOrder - bOrder;
  });
}

export function geometryToCoordinateRows(geomType, coordinates) {
  const rows = [];

  if (geomType === "Point") {
    rows.push({ partIndex: 0, ringIndex: 0, pointOrder: 0, lon: Number(coordinates[0]), lat: Number(coordinates[1]) });
    return rows;
  }

  if (geomType === "LineString") {
    coordinates.forEach((coord, idx) => {
      rows.push({ partIndex: 0, ringIndex: 0, pointOrder: idx, lon: Number(coord[0]), lat: Number(coord[1]) });
    });
    return rows;
  }

  if (geomType === "Polygon") {
    coordinates.forEach((ring, ringIndex) => {
      ring.forEach((coord, idx) => {
        rows.push({ partIndex: 0, ringIndex, pointOrder: idx, lon: Number(coord[0]), lat: Number(coord[1]) });
      });
    });
    return rows;
  }

  if (geomType === "MultiLineString") {
    coordinates.forEach((line, partIndex) => {
      line.forEach((coord, idx) => {
        rows.push({ partIndex, ringIndex: 0, pointOrder: idx, lon: Number(coord[0]), lat: Number(coord[1]) });
      });
    });
    return rows;
  }

  if (geomType === "MultiPolygon") {
    coordinates.forEach((polygon, partIndex) => {
      polygon.forEach((ring, ringIndex) => {
        ring.forEach((coord, idx) => {
          rows.push({ partIndex, ringIndex, pointOrder: idx, lon: Number(coord[0]), lat: Number(coord[1]) });
        });
      });
    });
    return rows;
  }

  throw new Error(`Unsupported geomType: ${geomType}`);
}

export function buildGeometryFromRows(geomType, rows) {
  const sorted = sortRows(rows);

  if (geomType === "Point") {
    if (!sorted.length) return null;
    return { type: "Point", coordinates: toCoord(sorted[0]) };
  }

  if (geomType === "LineString") {
    return {
      type: "LineString",
      coordinates: sorted.map((row) => toCoord(row)),
    };
  }

  if (geomType === "Polygon") {
    const rings = new Map();
    for (const row of sorted) {
      const ringIndex = Number(getRowValue(row, "ringIndex") || 0);
      if (!rings.has(ringIndex)) rings.set(ringIndex, []);
      rings.get(ringIndex).push(toCoord(row));
    }

    return {
      type: "Polygon",
      coordinates: [...rings.entries()]
        .sort((a, b) => a[0] - b[0])
        .map((entry) => entry[1]),
    };
  }

  if (geomType === "MultiLineString") {
    const lines = new Map();
    for (const row of sorted) {
      const partIndex = Number(getRowValue(row, "partIndex") || 0);
      if (!lines.has(partIndex)) lines.set(partIndex, []);
      lines.get(partIndex).push(toCoord(row));
    }

    return {
      type: "MultiLineString",
      coordinates: [...lines.entries()]
        .sort((a, b) => a[0] - b[0])
        .map((entry) => entry[1]),
    };
  }

  if (geomType === "MultiPolygon") {
    const polygons = new Map();

    for (const row of sorted) {
      const partIndex = Number(getRowValue(row, "partIndex") || 0);
      const ringIndex = Number(getRowValue(row, "ringIndex") || 0);

      if (!polygons.has(partIndex)) polygons.set(partIndex, new Map());
      const rings = polygons.get(partIndex);
      if (!rings.has(ringIndex)) rings.set(ringIndex, []);
      rings.get(ringIndex).push(toCoord(row));
    }

    return {
      type: "MultiPolygon",
      coordinates: [...polygons.entries()]
        .sort((a, b) => a[0] - b[0])
        .map((entry) => {
          const rings = entry[1];
          return [...rings.entries()]
            .sort((a, b) => a[0] - b[0])
            .map((ringEntry) => ringEntry[1]);
        }),
    };
  }

  throw new Error(`Unsupported geomType: ${geomType}`);
}
