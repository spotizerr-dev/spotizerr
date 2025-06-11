import axios from "axios";
import { toast } from "sonner";

const apiClient = axios.create({
  baseURL: "/api",
  headers: {
    "Content-Type": "application/json",
  },
  timeout: 10000, // 10 seconds timeout
});

// Response interceptor for error handling
apiClient.interceptors.response.use(
  (response) => {
    const contentType = response.headers["content-type"];
    if (contentType && contentType.includes("application/json")) {
      return response;
    }
    // If the response is not JSON, reject it to trigger the error handling
    const error = new Error("Invalid response type. Expected JSON.");
    toast.error("API Error", {
      description: "Received an invalid response from the server. Expected JSON data.",
    });
    return Promise.reject(error);
  },
  (error) => {
    if (error.code === "ECONNABORTED") {
      toast.error("Request Timed Out", {
        description: "The server did not respond in time. Please try again later.",
      });
    } else {
      const errorMessage = error.response?.data?.error || error.message || "An unknown error occurred.";
      toast.error("API Error", {
        description: errorMessage,
      });
    }
    return Promise.reject(error);
  },
);

export default apiClient;
