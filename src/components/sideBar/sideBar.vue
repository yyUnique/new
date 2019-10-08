<template>
  <div class="container" :style="roleType==1004?backStyle:roleType==1005?backStyle1:roleType==1006?backStyle2:''">
    <div class="top" flex="cross:center main:center">
      <img src="./images/logo.png" alt="" style="width:100%;">
    </div>

    <div class="list">
      <!-- 维保 -->
      <div :key="index" v-for="(route,index)  in weibaoMunu" class="outRoute" v-if="roleType==1004">
        <div style="margin-bottom:15px">
          <div :class="['item',{'item1':route.submenuList.length>0},{'item-focus1':nowRouter==route.path}]" flex="cross:center main:justify" @click="toUrl(route,1)">
            <div class="name">{{route.name}}</div>
          </div>
          <div :class="['item','item1',{'item-focus1':nowRouter==childItem.path}]" @click="toUrl(childItem,1)" flex="cross:center main:justify" v-for="(childItem,childIndex) in route.submenuList" :key="childIndex">
            <div class="name">{{childItem.name}}</div>
            <div :class="['arrow',{'arrow-focus':nowRouter==childItem.path}]"><img src="./images/arrow.png" alt=""></div>
          </div>  
        </div>      
      </div>
    </div>
  </div>
</template>
<script>
import { menuList } from '../../api/apis/auth'
import { TokenKeys } from '@/common/js/variable'
export default {
  name: "sideBar",
  data() {
    return {
      routes: [],
      backStyle: { 'background': '#03B7B0' },
      backStyle1: { 'background': '#0064D0' },
      backStyle2: { 'background': '#00A73C' },
      wuyeList: [
        // 电梯概况 
        {
          path: '/situation',
          name: '电梯概况',
        },
        // 维保计划
        {
          path: '/maintenancePlan',
          name: '维保计划',
        },
        // 用户管理
        {
          path: '/userAdmin',
          name: '用户管理',
        },
        // 业主管理
        {
          path: '/ownerAdmin',
          name: '业主管理',
        },
        // 物业-保险合同  insuranceContract
        {
          path: '/insuranceContract',
          name: '保险合同',
        },
      ],
      baoxianList: [
        // 保险概况 
        {
          path: '/baoXianIndex',
          name: '保险概况',
        },
        // 产品管理
        {
          path: '/productManage',
          name: '产品管理',
        },
        // 赔保记录
        {
          path: '/compensateRecord',
          name: '赔保记录',
        },
        // 投保记录
        {
          path: '/insuranceRecord',
          name: '投保记录',
        },
      ],
      weibaoMunu: [
        // 维保首页 
        {
          path: '/maintenanceIndex',
          name: '数据概况',
          submenuList:[]
        },
        // 电梯管理
        {
          path: '',
          name: '电梯管理',
          submenuList:[
            {
              path: '/elevatorManagement',
              name: '电梯列表',
            },
            {
              path: '/maintAdmin',
              name: '维保管理',
            },
            {
              path: '/repairAdmin',
              name: '维修管理',
            }
          ]
        },
        //人员管理
        {
          path: '',
          name: '系统管理',
          submenuList:[
            {
              path: '',
              name: '账号设置',
            },
            {
              path: '',
              name: '提醒设置',
            },
            {
              path: '',
              name: '权限设置',
            }
          ]
        },
        //人员管理
        {
          path: '',
          name: '人员管理',
          submenuList:[
            {
              path: '',
              name: '考勤管理',
            },
            {
              path: '',
              name: '员工管理',
            },
            {
              path: '',
              name: '日志管理',
            }
          ]
        },
        // // 人员管理
        // {
        //   path: '/maintUserAdmin',
        //   name: '人员管理',
        // },
        // // 角色管理
        // {
        //   path: '/',
        //   name: '角色管理',
        // },
      ],
      roleType: null,
      roleType: null
    }
  },
  mounted() {
    // this.menuList();
    this.roleType = localStorage.getItem(TokenKeys.ROLE_TYPE);
  },
  computed: {
    nowRouter() {
      return this.$route.path ? this.$route.path : ''
    }
  },
  methods: {
    // 跳转大数据页面
    changePage() {
      this.$store.commit('CHANGE_PAGE', true);
    },
    toUrl(route, num) {
      if(route.path==''){

      }else{
        this.$router.push({ path: route.path })
      }
      // if (route.submenuList.length<=0) {
      //   route.ifDown = !route.ifDown
      // } else {
      //   this.$router.push({ path: route.path })
      // }

    },
    menuList() {
      const params = {}
      menuList(params).then(res => {
        const { code, data } = res;
        if (code == 10000) {
          this.routes = data || []
          this.routes.forEach((item, index) => {
            this.$set(item, 'ifDown', false)
          })
        }
      }).catch(err => {

      })
    }
  }
}
</script>

<style scoped lang="scss">
.container {
  height: 100%;
  // background: skyblue;
  position: relative;
  overflow: auto;
  // background: url('../../images/bgImg.png') no-repeat center center;
  // background-size: cover;
}
// .container::-webkit-scrollbar {
//     display: none;
// }
.bgImg {
  position: absolute;
  width: 100%;
  top: 0px;
  left: 0px;
  height: 100%;
  font-size: 0;

  img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }
}
.arrow {
  width: 16px;
  height: 9px;
  font-size: 0;
  img {
    width: 100%;
    height: 100%;
  }
}
.arrow-focus {
  transform: rotate(-90deg);
}
$color: #fff;
@mixin el {
  color: $color;
  @content;
  height: 50px;
  font-size: 18px;
  color: rgba(255, 255, 255, 1);
        &-focus1{

            // color:rgba(39,254,182,1);
            background:white;
            color:rgba(0,172,186,1);
            border-left: 5px solid rgba(0,242,222,1);
        }
        &-focus2{

            // color:rgba(39,254,182,1);
            background:white;
            color:rgba(10,93,186,1);
            border-left: 5px solid rgba(84,184,255,1);
        }
        &-focus3{

            // color:rgba(39,254,182,1);
            background:white;
            color:rgba(0,158,50,1);
            border-left: 5px solid rgba(2,255,82,1);
        }
    }
    .item1{
        background:rgba(0,154,131,1);
    }
    .item2{
        background:rgba(0,86,178,1);
    }
    .item3{
        background:rgba(0,154,35,1);
    }
    .outRoute{
        // margin: 0 10px;
        // margin-bottom: 10px;
    }
    .fade-enter-active, .fade-leave-active {
        transition: opacity .5s;
    }
    .fade-enter, .fade-leave-to /* .fade-leave-active below version 2.1.8 */ {
        opacity: 0;
    }
    .item{
        @include el;
        cursor: pointer;
        padding: 15px;
    }
    .top{
        // @include el;
        cursor:pointer;
        position: absolute;
        top:0;
        left:0;
        right:0;
        height: 80px;
        z-index: 1000;
    }
    .list{
        padding-top: 96px;
        height: 100%;
        box-sizing: border-box;
        position: relative;
        z-index: 100;
    }
    .icon{
        // @include imgBox(20px,20px,contain);
        margin-right: 10px;
    }
    .name{
        width: 90px;
        font-size: 15px;
    }
</style>