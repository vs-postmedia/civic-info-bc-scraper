// import fs from 'fs'
import axios from 'axios';
import path from 'path';
// import data2022 from './data/data2022.js';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import saveData from './scripts/save-data.js';
import schoolDistrictLookup from './data/schoolDistrictLookup.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// load .env from this project's directory, regardless of cwd
dotenv.config({ path: path.join(__dirname, '.env') });

// VARS
const data_dir = 'data';
const filename = 'data'; // temp file for data
const councilUrl = 'https://localelections.ca/api/api.php?region_id=9'; 
const parkUrl = 'https://localelections.ca/api/api.php?jurisdiction_type=13';
const schoolUrl = 'https://localelections.ca/api/api.php?jurisdiction_type=12';
const ballotUrl = 'https://localelections.ca/api/ref_api.php?year=2026';
const cpMonths = ['Jan.', 'Feb.', 'Mar.', 'Apr.', 'May', 'June', 'July', 'Aug.', 'Sept.', 'Oct.', 'Nov.', 'Dec.']
// const url = 'https://localelections.ca/api/api.php?region_id=9&year=2022'; 
// region_id=9  <–– Lower Mainland: INCLUDES SCHOOL DISTRICTS
// regional_district_id=30 <–– Metro Vancouver: NO SCHOOL DISTRICTS
// jurisdiction_type=13 <–– park board: NEEDS SEPARATE CALL
// jurisdiction_type=12 <–– school board



async function fetchData(url, apiKey) {
	let data;

	// fetch data
	console.log(`Downloading HTML from ${url}...`);
	try {
		const resp = await axios.get(url, {
			headers: {
				'api-key': apiKey
			}
		});
		
		data = resp.data;
	} catch (error) {
		console.error('Error fetching data:', error);
	}

	return data
}

function mergeTrusteeCandidates(data) {
	const municipalities = getMunicipalities(data);
	const schoolDistricts = getSchoolDistricts(data);

	for (const schoolDistrict of schoolDistricts) {
		if (COMBINED_TRUSTEE_DISTRICTS.includes(schoolDistrict.name)) {
			const allTrusteeCandidates = schoolDistrict.school_district_areas.flatMap(area => area.candidates || []);
			const allMatches = new Set();

			for (const area of schoolDistrict.school_district_areas) {
				findMatchingMunicipalities(area, schoolDistrict, municipalities).forEach(m => allMatches.add(m));
			}

			if (allMatches.size === 0) {
				console.warn(`No municipality match for school district "${schoolDistrict.name}"`);
				continue;
			}

			for (const municipality of allMatches) {
				municipality.candidates.push(...allTrusteeCandidates);
			}
			continue;
		}

		for (const area of schoolDistrict.school_district_areas) {
			const trusteeCandidates = area.candidates || [];
			if (trusteeCandidates.length === 0) continue;

			const matches = findMatchingMunicipalities(area, schoolDistrict, municipalities);

			if (matches.length === 0) {
				console.warn(`No municipality match for school district area "${area.name}" (${schoolDistrict.name})`);
				continue;
			}

			for (const municipality of matches) {
				municipality.candidates.push(...trusteeCandidates);
			}
		}
	}

	return data;
}

async function processData(councilData, vanParkData) {
	const schoolDistrictAreaIdsByMunicipalityId = new Map(
		schoolDistrictLookup.map(({ id, school_district_areas }) => [
			id,
			Array.isArray(school_district_areas) ? school_district_areas : [school_district_areas]
		])
	);
	const schoolDistrictByAreaId = new Map(
		councilData
			.filter(({ jurisdiction_type }) => jurisdiction_type === 'School District')
			.flatMap(schoolDistrict =>
				(schoolDistrict.school_district_areas || []).map(({ id }) => [id, schoolDistrict])
			)
	);

	const processedData = councilData.map(({
		id,
		ballots_cast,
		candidates,
		city,
		councillors_to_elect,
		estimated_eligible_voters,
		jurisdiction_type,
		name,
		population,
		region,
		regional_district,
		registered_voters,
		school_district_areas
	}) => ({
		id,
		ballots_cast,
		candidates,
		city,
		councillors_to_elect,
		estimated_eligible_voters,
		jurisdiction_type,
		name,
		population,
		region,
		regional_district,
		registered_voters,
		...(() => {
			const areaIds = schoolDistrictAreaIdsByMunicipalityId.get(id) || [];
			const schoolDistrict = areaIds.map(areaId => schoolDistrictByAreaId.get(areaId)).find(Boolean);
			const schoolDistrictArea = schoolDistrict?.school_district_areas?.find(({ id }) =>
				areaIds.includes(id)
			);
			return schoolDistrict && {
				school_district: {
					id: schoolDistrict.id,
					jurisdiction_type: schoolDistrict.jurisdiction_type,
					city: schoolDistrict.city,
					school_district_areas: schoolDistrictArea ? [schoolDistrictArea] : []
				}
			};
		})(),
		...(id === '139' && { park_board: vanParkData }) // add vancouver park board
	}));

	// Electoral Area A
	const metroVancouverArea = councilData
		.find(({ id }) => id === '164')
		?.electoral_areas
		?.find(({ id }) => id === '85');

	return [
		...processedData.filter(({ id, jurisdiction_type }) =>
			id !== '164' && jurisdiction_type !== 'School District'
		),
		...(metroVancouverArea ? [metroVancouverArea] : [])
	];
}

async function init() {
	const apiKey = process.env.CIVICELECTIONSBC_API_KEY;

	// get data
	const councilData = await fetchData(councilUrl, apiKey);
	const parkData = await fetchData(parkUrl, apiKey);
	// const ballotData = await fetchData(ballotUrl, apiKey)
 
	// we only want some fields from Vancouver Park Board
	const vanParkData = parkData
		.filter(d => d.id === '301')
		.map(({
			id,
			name,
			jurisdiction_type,
			councillors_to_elect,
			estimated_eligible_voters,
			ballots_cast,
			registered_voters,
			candidates
		}) => ({
			id,
			name,
			jurisdiction_type,
			councillors_to_elect,
			estimated_eligible_voters,
			ballots_cast,
			registered_voters,
			candidates
		}));

	// process data for dashboard
	const processedData = await processData(councilData, vanParkData[0]);
	const timestampParts = new Intl.DateTimeFormat('en-CA', {
		timeZone: 'America/Vancouver',
		month: 'numeric',
		day: 'numeric',
		hour: 'numeric',
		minute: '2-digit',
		hour12: true
	}).formatToParts();
	const timestampValues = Object.fromEntries(
		timestampParts
			.filter(({ type }) => type !== 'literal')
			.map(({ type, value }) => [type, value])
	);
	const month = cpMonths[Number(timestampValues.month) - 1];
	const dayPeriod = timestampValues.dayPeriod.toLowerCase();

	const outputData = {
		data: processedData,
		timestamp: `${month} ${timestampValues.day}, ${timestampValues.hour}:${timestampValues.minute} ${dayPeriod}`
	};

	saveData(outputData, path.join(__dirname, `${data_dir}/data-2022`), 'json');
	// saveData(councilData, path.join(__dirname, `${data_dir}/council-data`), 'json');
	// saveData(schoolData, path.join(__dirname, `${data_dir}/school-districts`), 'json');
	// saveData(ballotData, path.join(__dirname, `${data_dir}/ballots-2026`), 'json');
}


// kick isht off!!!
init(); 

