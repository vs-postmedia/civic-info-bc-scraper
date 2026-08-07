import 'dotenv/config';
// import fs from 'fs'
import axios from 'axios';
import path from 'path';
import data2022 from './data/data2022.js';
import { fileURLToPath } from 'url';
import saveData from './scripts/save-data.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// VARS
const data_dir = 'data';
const filename = 'data'; // temp file for data
// region_id 9 is Lower Mainland
const url = 'https://localelections.ca/api/api.php?region_id=9&year=2022'; 


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
		saveData(resp.data, path.join(__dirname, `${data_dir}/${filename}`), 'json');
	} catch (error) {
		console.error('Error fetching data:', error);
	}

	return data
}
async function init(url) {
	const apiKey = process.env.CIVICELECTIONSBC_API_KEY;

	// get data
	const data = await fetchData(url, apikey);

	// process data for dashboard
	const processedData = await processData(data);

	// saveData(processedData, path.join(__dirname, `${data_dir}/data-final`), 'csv');
}


// kick isht off!!!
init(url); 




