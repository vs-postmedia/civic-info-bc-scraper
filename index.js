// import fs from 'fs'
import axios from 'axios';
import path from 'path';
// import data2022 from './data/data2022.js';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import saveData from './scripts/save-data.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// load .env from this project's directory, regardless of cwd
dotenv.config({ path: path.join(__dirname, '.env') });

// VARS
const data_dir = 'data';
const filename = 'data'; // temp file for data
const url = 'https://localelections.ca/api/api.php?year=2022&region_id=9'; 
// const url = 'https://localelections.ca/api/api.php?region_id=9&year=2022'; 
// region_id=9  <–– Lower Mainland: INCLUDES SCHOOL DISTRICTS
// regional_district_id=30 <–– Metro Vancouver: NO SCHOOL DISTRICTS
// jurisdiction_type=13 <–– park board: NEEDS SEPARATE CALL



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
function normalize(str) {
	return str.trim().toLowerCase();
}

function escapeRegExp(str) {
	return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// top-level entries that hold their own council/mayor candidates directly
function getMunicipalities(data) {
	return data.filter(d => Array.isArray(d.candidates));
}

// top-level entries that hold trustee candidates grouped by school_district_areas
function getSchoolDistricts(data) {
	return data.filter(d => Array.isArray(d.school_district_areas));
}

// find the municipality/municipalities a school district area's trustees belong to
function findMatchingMunicipalities(area, schoolDistrict, municipalities) {
	const areaName = normalize(area.name);

	// disambiguate places that share a name (e.g. Langley, North Vancouver) using
	// keywords like "city"/"township"/"district" present in the area name
	let typeHint = null;
	if (/\bcity\b/.test(areaName)) typeHint = 'City';
	else if (/\btownship\b/.test(areaName)) typeHint = 'Township';
	else if (/\bdistrict\b/.test(areaName)) typeHint = 'District';

	// areas qualified by words like "rural"/"island"/"greater"/"grand" refer to
	// places outside a specific municipality (e.g. "Squamish Rural", "Vancouver Island",
	// "Greater Vancouver" / "Grand Vancouver") and should never match one
	const isDisqualified = /\b(rural|island|greater|grand)\b/.test(areaName);

	// match municipality names as whole words
	let matches = isDisqualified ? [] : municipalities.filter(m => {
		const pattern = new RegExp(`\\b${escapeRegExp(normalize(m.name))}\\b`);
		return pattern.test(areaName);
	});

	// drop matches that are just part of another, longer matched name
	// (e.g. "Coquitlam" matching inside "Port Coquitlam"); places that share the
	// exact same name (e.g. Langley, North Vancouver) are left for the type hint below
	matches = matches.filter(m => {
		const name = normalize(m.name);
		return !matches.some(other => normalize(other.name).length > name.length && normalize(other.name).includes(name));
	});

	if (typeHint && matches.some(m => m.jurisdiction_type === typeHint)) {
		matches = matches.filter(m => m.jurisdiction_type === typeHint);
	}

	// generic single-area districts (e.g. "At Large") fall back to the district's own name
	if (matches.length === 0 && schoolDistrict.school_district_areas.length === 1) {
		matches = municipalities.filter(m => normalize(m.name) === normalize(schoolDistrict.name));
	}

	return matches;
}

// school districts whose trustees govern multiple municipalities as a single board,
// so every trustee (from every area) should appear on each municipality's list
const COMBINED_TRUSTEE_DISTRICTS = ['Langley', 'North Vancouver'];

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

async function processData(data) {

	// merge school trustees into candidates array
	mergeTrusteeCandidates(data);

	// filter for metro van
	const metroData = data.filter(d => d.regional_district === 'Metro Vancouver');

	return metroData;
}

async function init(url) {
	const apiKey = process.env.CIVICELECTIONSBC_API_KEY;

	// get data
	const data = await fetchData(url, apiKey);

	// process data for dashboard
	const processedData = await processData(data);

	saveData(processedData, path.join(__dirname, `${data_dir}/data-final`), 'csv');
	saveData(processedData, path.join(__dirname, `${data_dir}/data-2022`), 'json');
}


// kick isht off!!!
init(url); 




