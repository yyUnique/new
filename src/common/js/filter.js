import Vue from "vue";
import { div,dateFormat, getSendTime} from "@/common/js/util"

// 金额单位分 转成元
export function transferMoney(cent = 0) {
  return div(cent, 100)
}

const filters = {
  transferMoney,
  dateFormat,
  getSendTime
}
export default filters;

Object.keys(filters).forEach(key => {
  Vue.filter(key, filters[key]);
});
