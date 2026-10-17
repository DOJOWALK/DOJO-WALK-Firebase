export function auditSnapshot(snapshot) {
  const collections = ['service_countries','service_states','service_cities','service_areas','service_localities','service_location_boundaries'];
  if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) {
    throw new Error('Snapshot root must be a JSON object.');
  }
  for (const name of collections) {
    if (!snapshot[name] || typeof snapshot[name] !== 'object' || Array.isArray(snapshot[name])) {
      throw new Error(`Snapshot must include object collection "${name}" keyed by document ID.`);
    }
    for (const [id, doc] of Object.entries(snapshot[name])) {
      if (!doc || typeof doc !== 'object' || Array.isArray(doc)) {
        throw new Error(`Document "${name}/${id}" must be a JSON object.`);
      }
    }
  }
  const issues = [];
  const counts = Object.fromEntries(collections.map(name => [name, Object.keys(snapshot[name]).length]));
  const add = (type,id,code,detail) => issues.push({type,id,code,detail});
  const c=snapshot.service_countries, s=snapshot.service_states, ci=snapshot.service_cities, a=snapshot.service_areas, l=snapshot.service_localities, b=snapshot.service_location_boundaries;
  const validateBoundary = (type, id, doc) => {
    const boundaryId = doc.verifiedBoundaryId;
    if (typeof boundaryId !== 'string' || !boundaryId || !b[boundaryId]) {
      add(type,id,'MISSING_VERIFIED_BOUNDARY',`verifiedBoundaryId "${boundaryId ?? ''}" does not resolve`);
      return;
    }
    const boundary = b[boundaryId];
    if (boundary.locationId !== id || boundary.locationType !== type || boundary.verificationStatus !== 'verified' ||
        typeof boundary.sourceName !== 'string' || !boundary.sourceName.trim() ||
        typeof boundary.sourceReference !== 'string' || !boundary.sourceReference.trim() ||
        typeof boundary.verifiedBy !== 'string' || !boundary.verifiedBy.trim() || !boundary.verifiedAt) {
      add(type,id,'BOUNDARY_VERIFICATION_METADATA_INVALID',`Boundary "${boundaryId}" is not a fully verified boundary for this location`);
    }
    if (!Array.isArray(boundary.points) || boundary.points.length < 3) {
      add(type,id,'BOUNDARY_POINTS_INVALID',`Boundary "${boundaryId}" must contain at least three points`);
      return;
    }
    const points = boundary.points.map(p => {
      if (!p || typeof p !== 'object' || Array.isArray(p)) return null;
      const lat = typeof p.lat === 'number' ? p.lat : p.latitude;
      const lng = typeof p.lng === 'number' ? p.lng : p.longitude;
      return Number.isFinite(lat) && Number.isFinite(lng) && lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180 ? `${lat},${lng}` : null;
    });
    if (points.some(p => p === null) || new Set(points).size < 3) {
      add(type,id,'BOUNDARY_COORDINATES_INVALID',`Boundary "${boundaryId}" has invalid or fewer than three distinct coordinates`);
    }
  };
  for (const [id,d] of Object.entries(s)) {
    if (!c[d.countryId]) add('state',id,'MISSING_COUNTRY',`countryId "${d.countryId ?? ''}" does not resolve`);
    if (d.isActive===true && c[d.countryId]?.isActive!==true) add('state',id,'ACTIVE_UNDER_INACTIVE_COUNTRY','Active State has no active Country ancestor');
  }
  for (const [id,d] of Object.entries(ci)) {
    if (d.isServiceActive === true) validateBoundary('city',id,d);
    const st=s[d.stateId];
    if (!c[d.countryId]) add('city',id,'MISSING_COUNTRY',`countryId "${d.countryId ?? ''}" does not resolve`);
    if (!st) add('city',id,'MISSING_STATE',`stateId "${d.stateId ?? ''}" does not resolve`);
    else if (st.countryId!==d.countryId) add('city',id,'STATE_COUNTRY_MISMATCH','City countryId does not match its State countryId');
    if (d.isServiceActive===true && (c[d.countryId]?.isActive!==true || st?.isActive!==true)) add('city',id,'ACTIVE_UNDER_INACTIVE_ANCESTOR','Active City has an inactive or missing Country/State ancestor');
  }
  for (const [id,d] of Object.entries(a)) {
    if (d.isServiceActive === true) validateBoundary('area',id,d);
    const st=s[d.stateId], city=ci[d.cityId];
    if (!c[d.countryId]) add('area',id,'MISSING_COUNTRY',`countryId "${d.countryId ?? ''}" does not resolve`);
    if (!st) add('area',id,'MISSING_STATE',`stateId "${d.stateId ?? ''}" does not resolve`);
    else if (st.countryId!==d.countryId) add('area',id,'STATE_COUNTRY_MISMATCH','Area countryId does not match its State countryId');
    if (!city) add('area',id,'MISSING_CITY',`cityId "${d.cityId ?? ''}" does not resolve`);
    else if (city.countryId!==d.countryId || city.stateId!==d.stateId) add('area',id,'CITY_ANCESTRY_MISMATCH','Area Country/State IDs do not match its City');
    if (d.isServiceActive===true && (c[d.countryId]?.isActive!==true || st?.isActive!==true || city?.isServiceActive!==true)) add('area',id,'ACTIVE_UNDER_INACTIVE_ANCESTOR','Active Area has an inactive or missing ancestor');
  }
  for (const [id,d] of Object.entries(l)) {
    const st=s[d.stateId], city=ci[d.cityId], area=a[d.areaId];
    if (!c[d.countryId]) add('locality',id,'MISSING_COUNTRY',`countryId "${d.countryId ?? ''}" does not resolve`);
    if (!st) add('locality',id,'MISSING_STATE',`stateId "${d.stateId ?? ''}" does not resolve`);
    else if (st.countryId!==d.countryId) add('locality',id,'STATE_COUNTRY_MISMATCH','Locality countryId does not match its State countryId');
    if (!city) add('locality',id,'MISSING_CITY',`cityId "${d.cityId ?? ''}" does not resolve`);
    else if (city.countryId!==d.countryId || city.stateId!==d.stateId) add('locality',id,'CITY_ANCESTRY_MISMATCH','Locality Country/State IDs do not match its City');
    if (!area) add('locality',id,'MISSING_AREA',`areaId "${d.areaId ?? ''}" does not resolve`);
    else if (area.countryId!==d.countryId || area.stateId!==d.stateId || area.cityId!==d.cityId) add('locality',id,'AREA_ANCESTRY_MISMATCH','Locality Country/State/City IDs do not match its Area');
    if (d.isServiceActive===true && (c[d.countryId]?.isActive!==true || st?.isActive!==true || city?.isServiceActive!==true || area?.isServiceActive!==true)) add('locality',id,'ACTIVE_UNDER_INACTIVE_ANCESTOR','Active Locality has an inactive or missing ancestor');
  }
  const issueCountsByCode = Object.fromEntries(
    [...new Set(issues.map(issue => issue.code))].sort().map(code => [code, issues.filter(issue => issue.code === code).length]),
  );
  const issueCountsByType = Object.fromEntries(
    [...new Set(issues.map(issue => issue.type))].sort().map(type => [type, issues.filter(issue => issue.type === type).length]),
  );
  const metadata = snapshot.snapshotMetadata;
  let snapshotScope = {
    status: 'UNVERIFIED',
    sourceProjectId: null,
    exportedAt: null,
    collectionsIncluded: [],
    completeCollections: [],
    declaredRecordCounts: {},
    countMismatches: [],
    missingCollections: [...collections],
  };
  if (metadata && typeof metadata === 'object' && !Array.isArray(metadata)) {
    const includedIsArray = Array.isArray(metadata.collectionsIncluded);
    const completeIsArray = Array.isArray(metadata.completeCollections);
    const included = includedIsArray ? metadata.collectionsIncluded : [];
    const complete = completeIsArray ? metadata.completeCollections : [];
    const recordCountsIsObject = metadata.recordCounts !== null &&
      typeof metadata.recordCounts === 'object' && !Array.isArray(metadata.recordCounts);
    const declared = recordCountsIsObject ? metadata.recordCounts : {};
    const validNames = value => value.every(name => typeof name === 'string' && collections.includes(name));
    const unknownCollections = [...new Set([...included, ...complete].filter(name => typeof name === 'string' && !collections.includes(name)))];
    const unknownRecordCountKeys = Object.keys(declared).filter(name => !collections.includes(name)).sort();
    const duplicateCollectionEntries = [
      ...[...new Set(included.filter(name => typeof name === 'string' && included.indexOf(name) !== included.lastIndexOf(name)))].map(name => `collectionsIncluded:${name}`),
      ...[...new Set(complete.filter(name => typeof name === 'string' && complete.indexOf(name) !== complete.lastIndexOf(name)))].map(name => `completeCollections:${name}`),
    ].sort();
    const malformedCollectionLists = !includedIsArray || !completeIsArray ||
      !validNames(included) || !validNames(complete) || duplicateCollectionEntries.length > 0;
    const malformedRecordCounts = !recordCountsIsObject || unknownRecordCountKeys.length > 0;
    const missingCollections = collections.filter(name => !included.includes(name) || !complete.includes(name));
    const countMismatches = collections.filter(name =>
      !Number.isInteger(declared[name]) || declared[name] < 0 || declared[name] !== counts[name]);
    const hasProjectId = typeof metadata.sourceProjectId === 'string' && metadata.sourceProjectId.trim().length > 0;
    const exportedAtMatch = typeof metadata.exportedAt === 'string'
      ? metadata.exportedAt.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(Z|([+-])(\d{2}):(\d{2}))$/)
      : null;
    const hasValidCalendarTime = (() => {
      if (!exportedAtMatch) return false;
      const year = Number(exportedAtMatch[1]), month = Number(exportedAtMatch[2]), day = Number(exportedAtMatch[3]);
      const hour = Number(exportedAtMatch[4]), minute = Number(exportedAtMatch[5]), second = Number(exportedAtMatch[6]);
      const zone = exportedAtMatch[7], offsetHour = Number(exportedAtMatch[9]), offsetMinute = Number(exportedAtMatch[10]);
      const isLeapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
      const monthDays = [31, isLeapYear ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
      const daysInMonth = month >= 1 && month <= 12 ? monthDays[month - 1] : 0;
      if (day < 1 || day > daysInMonth || hour > 23 || minute > 59 || second > 59) return false;
      if (zone !== 'Z' && (offsetHour > 14 || offsetMinute > 59 || (offsetHour === 14 && offsetMinute !== 0))) return false;
      return true;
    })();
    const parsedExportTime = typeof metadata.exportedAt === 'string' ? Date.parse(metadata.exportedAt) : NaN;
    const hasValidExportTime = hasValidCalendarTime && Number.isFinite(parsedExportTime);
    const hasIdentity = hasProjectId && hasValidExportTime;
    snapshotScope = {
      status: hasIdentity && !malformedCollectionLists && unknownCollections.length === 0 &&
        missingCollections.length === 0 && countMismatches.length === 0 && !malformedRecordCounts ? 'DECLARED_COMPLETE' : 'INCOMPLETE_OR_UNVERIFIED',
      sourceProjectId: hasProjectId ? metadata.sourceProjectId : null,
      exportedAt: hasValidExportTime ? metadata.exportedAt : null,
      collectionsIncluded: included,
      completeCollections: complete,
      declaredRecordCounts: declared,
      countMismatches,
      missingCollections,
      unknownCollections,
      malformedCollectionLists,
      duplicateCollectionEntries,
      malformedRecordCounts,
      unknownRecordCountKeys,
      invalidExportTimestamp: !hasValidExportTime,
    };
  }
  return {
    audit: 'DOJO WALK service-location hierarchy integrity',
    mode: 'read-only offline snapshot; no Firebase connection; no source writes',
    snapshotScope,
    counts,
    totalRecords: Object.values(counts).reduce((sum,n) => sum + n, 0),
    issueCount: issues.length,
    issueCountsByCode,
    issueCountsByType,
    issues,
  };
}
