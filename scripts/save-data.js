import fs from 'fs';
import { Parser } from '@json2csv/plainjs';

async function saveData(data, filepath, format, data_dir) {
	console.log(`Saving data to ${filepath}`);

	// save file locally
	if (format === 'json') {
		try {
			fs.writeFileSync(`${filepath}.${format}`, JSON.stringify(data));
		} catch (err) {
			console.error(err);
		}
	} else {
		try {
			const parser = new Parser({
				withBOM: true
			});
			fs.writeFileSync(`${filepath}.${format}`, parser.parse(data));
		} catch (err) {
			console.error(err);
		}
	}
}


export default saveData;