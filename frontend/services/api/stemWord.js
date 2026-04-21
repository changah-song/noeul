import axios from 'axios';
import { BASE_URL } from '../../config';

const stemWord = async ({ query }) => {
  if (!query || query.trim() === "") return [];
  console.log(`[stemWord] Sending request for query: "${query}"`);
  try {
      const response = await axios.get(`${BASE_URL}/okt_morphs/`, {
          params: { text: query }
      });
      console.log(`[stemWord] Received ${response.data.result.length} stem(s):`, response.data.result);
      return response.data.result;

  } catch (error) {
      console.error("[stemWord] Error fetching morphs from Python API:", error);
      return [];
  }
};

export default stemWord;
