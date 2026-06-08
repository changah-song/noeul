import { api } from './client';

const stemWord = async ({ query }) => {
  if (!query || query.trim() === "") return [];
  try {
      const response = await api.get('/okt_morphs/', {
          params: { text: query }
      });
      return response.data.result;

  } catch (error) {
      console.error("[stemWord] Error fetching morphs from Python API:", error);
      return [];
  }
};

export default stemWord;
