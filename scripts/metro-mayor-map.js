import setTimestamp from './set-timestamp.js'

const metroIds = [1, 3, 6, 7, 20, 26, 61, 62, 64, 69, 82, 85, 86, 94, 98, 102, 112, 129, 139, 145, 147,180]

async function processMayors(processedData) {
    const data = processedData
        .filter(item => metroIds.includes(Number(item.id)))
        .map(item => {
        const {
            councillors_to_elect,
            population,
            region,
            regional_district,
            registered_voters,
            school_district,
            ...remainingProperties
        } = item;

        const mayorCandidates = (item.candidates || [])
            .filter(candidate => candidate.running_for === 'MAYOR');
        const ballotsCast = Number(item.ballots_cast || 0);
        const candidates = mayorCandidates
            .map(candidate => ({
                ...candidate,
                vote_percentage: ballotsCast
                    ? Number((Number(candidate.votes_for || 0) / ballotsCast * 100).toFixed(1))
                    : 0
            }))
            .sort((a, b) => Number(b.votes_for || 0) - Number(a.votes_for || 0))
            .slice(0, 3);

        return {
            ...remainingProperties,
            name: ['Langley', 'North Vancouver'].includes(item.name)
                ? `${item.name} ${item.jurisdiction_type}`
                : item.name,
            lead_name: candidates[0]?.candidate_last_name ?? null,
            elected: candidates[0]?.elected ?? null,
            acclaimed: candidates[0]?.acclamation ?? null,
            mov: candidates.length > 1
                ? Number((candidates[0].vote_percentage - candidates[1].vote_percentage).toFixed(1))
                : null,
            vote_lead: candidates.length > 1
                ? Number(candidates[0].votes_for || 0) - Number(candidates[1].votes_for || 0)
                : null,
            candidates
        };
    });

    return {
        data: data,
        timestamp: setTimestamp()
    }
}


export default processMayors;