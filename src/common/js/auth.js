import {TokenKeys} from "./variable";

export const getSessionToken = () => {
    return localStorage.getItem(TokenKeys.ACCESS_TOKEN) && localStorage.getItem(TokenKeys.SESSION_TOKEN) && (new Date().getTime() - localStorage.getItem(TokenKeys.SESSION_TOKEN) <= TokenKeys.SESSION_TIME);
};