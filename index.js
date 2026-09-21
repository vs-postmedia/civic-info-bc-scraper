// import fs from 'fs'
import axios from 'axios';
import path from 'path';
// import data2022 from './data/data2022.js';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import saveData from './scripts/save-data.js';
import chineseNames from './data/names-chinese.js';
import ballotSummaries from './data/ballot-summaries.js';
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
const ballotLookup = ['Langley (City)', 'Metro Vancouver (Regional District)', 'Vancouver'];
const cpMonths = ['Jan.', 'Feb.', 'Mar.', 'Apr.', 'May', 'June', 'July', 'Aug.', 'Sept.', 'Oct.', 'Nov.', 'Dec.']
// const url = 'https://localelections.ca/api/api.php?region_id=9&year=2022'; 
// region_id=9  <–– Lower Mainland: INCLUDES SCHOOL DISTRICTS
// regional_district_id=30 <–– Metro Vancouver: NO SCHOOL DISTRICTS
// jurisdiction_type=13 <–– park board: NEEDS SEPARATE CALL
// jurisdiction_type=12 <–– school board


async function addBallotResults(processedData, ballotResults) {
	return processedData.map(item => ({
		...item,
		ballot_results: ballotResults.filter(({ id }) => id === item.id)
	}));
}

async function addChineseNames(chineseNames, data) {
	const chineseNameLookup = new Map(
		chineseNames.map(candidate => [
			[ candidate.id, candidate.candidate_first_name, candidate.candidate_last_name ]
				.map(value => String(value || '').trim())
				.join('|'),
			candidate.candidate_chinese_name
		])
	);

	return data.map(item => ({
		...item,
		candidates: (item.candidates || []).map(candidate => ({
			...candidate,
			candidate_chinese_name: chineseNameLookup.get(
				[ item.id, candidate.candidate_first_name, candidate.candidate_last_name ]
					.map(value => String(value || '').trim())
					.join('|')
			) ?? null
		}))
	}));
}

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

function formatTimestamp() {
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
	
	return `${month} ${timestampValues.day}, ${timestampValues.hour}:${timestampValues.minute} ${dayPeriod}`;
}

async function getTurnout(data) {
	return data.map(({
		id,
		name,
		jurisdiction_type,
		ballots_cast,
		estimated_eligible_voters
	}) => ({
		id,
		name,
		jurisdiction_type,
		ballots_cast,
		estimated_eligible_voters
	}));
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

const CANDIDATE_FIELDS_TO_REMOVE = [
	'candidate_usualname',
	'candidate_contact_consent',
	'candidate_phone',
	'candidate_cell',
	'candidate_email',
	'candidate_website',
	'candidate_twitter',
	'candidate_bluesky',
	'candidate_facebook',
	'candidate_instagram',
	'candidate_youtube'
];

function stripCandidateFields(candidates) {
	return (candidates || []).map(candidate => {
		const filtered = { ...candidate };
		CANDIDATE_FIELDS_TO_REMOVE.forEach(field => delete filtered[field]);

		if (filtered.electoral_organization) {
			const {
				electoral_organization_address,
				electoral_organization_city,
				electoral_organization_phone,
				electoral_organization_email,
				...organization
			} = filtered.electoral_organization;
			filtered.electoral_organization = organization;
		}

		['candidate_first_name', 'candidate_last_name'].forEach(field => {
			if (typeof filtered[field] === 'string') {
				filtered[field] = filtered[field].replace(/&#39;/g, '’');
			}
		});
		return filtered;
	});
}

function mergeBallotResults(ballotSummaries, ballotData) {
	const ballotDataByRefId = new Map(ballotData.map(d => [d.refid, d]));

	const mergedData = ballotSummaries.map(summary => {
		const { passed, votes_against, votes_for } = ballotDataByRefId.get(summary.refid) || {};
		return { ...summary, passed, votes_against, votes_for };
	});

	return mergedData.filter(d => ballotLookup.includes(d.name)); 
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
		candidates: stripCandidateFields(candidates),
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
					school_district_areas: schoolDistrictArea
						? [{ ...schoolDistrictArea, candidates: stripCandidateFields(schoolDistrictArea.candidates) }]
						: []
				}
			};
		})(),
		...(id === '139' && {
			park_board: vanParkData && {
				...vanParkData,
				candidates: stripCandidateFields(vanParkData.candidates)
			}
		}) // add vancouver park board
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
		...(metroVancouverArea ? [{ ...metroVancouverArea, id: '164_85' }] : [])
	];
}

async function init() {
	const apiKey = process.env.CIVICELECTIONSBC_API_KEY;

	// get data
	const parkData = await fetchData(parkUrl, apiKey);
	const ballotData = await fetchData(ballotUrl, apiKey);
	const councilData = await fetchData(councilUrl, apiKey);

	/*
	// PROCESS DATA
	*/

	// add summaries & edited  to ballot data
	const ballotResults = mergeBallotResults(ballotSummaries, ballotData);
 
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
		
	const processedData = await processData(councilData, vanParkData[0]);

	const dataWithBallots = await addBallotResults(processedData, ballotResults);

	const finalData = await addChineseNames(chineseNames, dataWithBallots);

	
	// not sure if we'll use this...
	const turnoutData = await getTurnout(finalData);

	const outputData = {
		data: finalData,
		ballotData: ballotResults,
		timestamp: formatTimestamp()
	};

	saveData(outputData, path.join(__dirname, `${data_dir}/data-2026`), 'json');
	saveData(turnoutData, path.join(__dirname, `${data_dir}/turnout-2026`), 'json');
}


// kick isht off!!!
init(); 

