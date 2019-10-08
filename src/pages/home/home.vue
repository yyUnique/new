<template>
  <div style="width:100%;height:100%;">
    <!-- 大屏 -->
    <div class="home" flex>
      <!-- 主要内容页 -->
      <div :class="['left',{showStyle:!showLeft}]" flex-box="0">
        <div :class="['leftInner',{showInnerStyle:!showLeft}]">
          <v-side-bar />
        </div>
        <div class="showButton" @click.stop="toggle">
          <img :src="showLeft?innerImg:outImg" alt="" class="showImg">
        </div>
      </div>
      <div class="right" flex-box="1">
        <div class="top">
          <v-header />
        </div>
        <div class="bottom" ref="bottom">
          <keep-alive>
            <router-view v-if="this.$route.meta.keepAlive" />
          </keep-alive>
          <router-view v-if="!this.$route.meta.keepAlive" />
        </div>
      </div>
    </div>
  </div>

</template>

<script>
import vHeader from '../../components/vHeader/vHeader'
import vSideBar from '../../components/sideBar/sideBar'
// import bigData from '../../views/bigData/bigData'
export default {
  name: 'home',
  data() {
    return {
      showLeft: true,
    //   outImg: require('../../images/outBtn.png'),
    //   innerImg: require('../../images/innerBtn.png')
    }
  },
  watch: {
      '$route': function(to,from){ 
          // 页面切换后，回到顶部 
          let nodeS = this.$refs.bottom;
          nodeS.scrollTop = 0;
    　 
      }
  },
  components: {
    vHeader,
    vSideBar,
    // bigData
  },
//   computed: {
//     pageState: function () {
//       return this.$store.state.pageState
//     }
//   },
  methods: {
    toggle() {
      this.showLeft = !this.showLeft
    },
    changePage() {
      this.$store.commit('CHANGE_PAGE', false);
    }
  }

}
</script>
<style scoped lang="scss">
.bigBox {
  width: 100%;
  height: 100%;
  position: relative;
  .box {
    width: 50%;
    height: 10%;
    cursor: pointer;
    opacity: 0;
    position: absolute;
    top: 0;
    left: 50%;
    transform: translateX(-50%);
  }
}
.home {
  width: 100%;
  height: 100%;
}
.left {
  height: 100%;
  width: 270px;
  position: relative;
  background: black;
  z-index: 10;
  transition: width 0.5s ease-in-out;
}
.showButton {
  width: 20px;
  height: 100px;
  position: absolute;
  top: 0;
  bottom: 0;
  margin: auto;
  right: -20px;
  // background: red;
}
.showImg {
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.leftInner {
  width: 270px;
  height: 100%;
  overflow: hidden;
  transition: transform 0.5s ease-in-out;
}
.showStyle {
  width: 0;
}
.showInnerStyle {
  transform: translate(-100%, 0);
}
.right {
  height: 100%;
  width: 0;
  background: #fff;
  box-sizing: border-box;
  position: relative;
}
.top {
  position: absolute;
  z-index: 100;
  top: 0;
  left: 0;
  right: 0;
  height: 64px;
}
.bottom {
  background-color: #eee;
  padding: 84px 20px 0;
  width: 100%;
  height: 100%;
  overflow: auto;
  &:after {
    content: "";
    display: block;
    height: 20px;
  }
}
</style>