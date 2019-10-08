<template>
    <div class="container" flex="cross:center">
        <div v-if="nowRouter&&nowRouter.meta&&nowRouter.meta.back" class="back" flex-box='0' flex="cross:center" @click="goBack">
            <div class="img"></div>
            <div class="font">返回</div>
        </div>
        <div class="visitNum" flex-box='0' flex="cross:center">
            <!-- <div class="viewImg"></div> -->
            <!-- <div class="font">访问总量:{{detailData.visitNum}}</div> -->
            <!-- <div class="font realName">欢迎你，{{detailData.organName}}{{detailData.organName?",":''}}{{detailData.realName}}</div> -->
        </div>
        <div class="topPart" flex-box='1' flex="cross:center main:around">
            <div class="time font">{{date}}</div>
            <div>
                <iframe scrolling="no" src="https://tianqiapi.com/api.php?style=tz&skin=sogou" frameborder="0" width="350px" height="20" allowtransparency="true"></iframe>
            </div>
            <!-- <a href="https://www.tianqi.com/hangzhou/?tq" class="font" target="_blank">杭州</a> -->
            <el-dropdown class="user">
                <div class="el-dropdown-link">
                    <!-- <span style="margin-right:10px;font-size:14px;">欢迎你</span> -->
                    <!-- <img src="../../images/man_user.png" alt=""> -->
                    <span class="font">{{detailData.realName}}</span>
                    <i class="el-icon-caret-bottom"></i>
                </div>
                <el-dropdown-menu slot="dropdown" class="dropdown">
                    <el-dropdown-item @click.native="logout()"><i class="dropdown-icon logout font"></i>退出账户</el-dropdown-item>
                </el-dropdown-menu>
            </el-dropdown>
        </div>
    </div>
    <!-- <div class="loginout" flex-box='1' @click="logout()" flex="cross:center">
            <div flex="cross:center" class="clickPart">
                <div class="loginoutImg"></div>
                <div class="font">退出登录</div>        
            </div>
        </div> -->
</template>

<script>
import { dateFormat } from "../../common/js/util";
import router from '@/router'
import { userInfo, logOut } from '@/api/apis/auth'
import { TokenKeys } from '@/common/js/variable'
export default {
  name: "vHeader",
  data() {
    return {
      date: '',
      week: ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六'],
      detailData: {}
    }
  },
  computed: {
    nowRouter() {
      return this.$route ? this.$route : {}
    }
  },
  mounted() {
    this.userInfo()
    this.date = dateFormat(new Date(), 'yyyy年M月d日 ') + ' ' + this.week[new Date().getDay()]
  },
  methods: {
    goBack() {
      this.$router.go(-1);
    },
    // 登出
    logout() {
      logOut().then(res => {
        localStorage.clear();
        router.replace({ path: '/login' });
        this.$store.commit('CHANGE_PAGE', true);
      })
    },
    userInfo() { //判断用户身份
      const params = {}
      userInfo(params).then(res => {
        const { code, data } = res;
        if (code == 10000) {
          this.detailData = data;
          // localStorage.setItem(TokenKeys.ROLE_TYPE, data.roleType);
          if (!data.bulletinFlag || data.bulletinFlag == 1202) {
            // this.$alert('系统已升级！！！如遇见使用问题请联系 杭钢 陈刚平 86090840', '公告', {
            //   confirmButtonText: '确定',
            //   callback: action => {

            //   }
            // });
          }
        }
      }).catch(err => {

      })
    },
  }
}
</script>

<style scoped lang="scss">
.container {
  height: 64px;
  background: #ffffff;
  box-shadow: 0 0 10px #888;
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
}
.visitNum {
  // max-width: 40%;
  // width: 40%;
  padding-left: 2%;
  .viewImg {
    width: 22px;
    height: 22px;
    margin: 0 10px;
    // background: url("../../images/visit.png") no-repeat center center/contain;
  }
  .font {
    font-size: 14px;
  }
}
.user {
  padding-right: 25px;
  vertical-align: middle;
  img {
    border-radius: 50%;
    margin-right: 5px;
    width: 24px;
    height: 24px;
    vertical-align: middle;
  }
  .el-dropdown-link {
    cursor: pointer;
    display: flex;
    align-items: center;
  }
}
.dropdown {
  .dropdown-icon {
    display: inline-block;
    width: 20px;
    height: 20px;
    margin-right: 5px;
    vertical-align: middle;
    &.logout {
      background: url("./images/logout.png") no-repeat center center/contain;
    }
  }
}
.el-dropdown-menu {
  padding: 0;
}
.topPart {
  // width: 60%;
  .font {
    font-size: 14px;
  }
}
.back {
  height: 100%;
  cursor: pointer;
  .img {
    width: 10px;
    height: 18px;
    margin: 0 10px;
    background: url("./images/back.png") no-repeat center center/contain;
  }

  .font {
    font-size: 14px;
    color: #333;
  }
}
.loginout {
  align-items: center;
  // cursor: pointer;
  position: relative;
  .loginoutImg {
    width: 25px;
    height: 25px;
    background: url("./images/logout.png") no-repeat center center/contain;
  }
  .font {
    font-size: 16px;
    color: #333;
  }
  .clickPart {
    position: absolute;
    right: 50px;
    cursor: pointer;
  }
}
.realName {
  margin-left: 20%;
}
</style>